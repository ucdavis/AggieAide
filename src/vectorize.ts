import { Client, ClientOptions } from '@elastic/elasticsearch';
import {
  ElasticClientArgs,
  ElasticVectorSearch,
} from 'langchain/vectorstores/elasticsearch';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from 'langchain/document';
import dotenv from 'dotenv';
import * as fs from 'fs';
import { IndicesUpdateAliasesAction } from '@elastic/elasticsearch/lib/api/types';

dotenv.config();

// let's try to do full RAG with OpenAI assistants & ElasticSearch
const apiKey = process.env.OPENAI_API_KEY; // Replace with your API key or use environment variable
if (!apiKey) {
  console.error('OpenAI API key is required');
  process.exit(1);
}

// embeddings
const embeddings = new OpenAIEmbeddings();

// get my vector store
// const config: ClientOptions = {
//   node: process.env.ELASTIC_URL ?? 'http://127.0.0.1:9200',
// };

const config: ClientOptions = {
  node: process.env.ELASTIC_URL ?? 'http://127.0.0.1:9200',
  auth: {
    username: process.env.ELASTIC_WRITE_USERNAME ?? 'elastic',
    password: process.env.ELASTIC_WRITE_PASSWORD ?? 'changeme',
  },
};

// we are going to store in a versioned index and then update the alias
const elasticIndexAlias = process.env.ELASTIC_INDEX ?? 'aggieaide_vectorstore';
const realIndexName = `aggieaide_vectorstore_${Date.now()}`;

const clientArgs: ElasticClientArgs = {
  client: new Client(config),
  indexName: realIndexName,
  vectorSearchOptions: {
    similarity: 'cosine', // since this is what openAI uses
  },
};

const createAndUpdateAlias = async () => {
  try {
    // Step 0: Assume the index is already created, since langchain does that for us

    // Find all indices the alias currently points to
    const aliasExists = await clientArgs.client.indices.existsAlias({
      name: elasticIndexAlias,
    });

    const actions: IndicesUpdateAliasesAction[] = [
      { add: { index: realIndexName, alias: elasticIndexAlias } },
    ];

    const indexesToRemove: string[] = [];

    // if we already have an alias, remove it from all the indexes it points to
    // and then delete the old indexes
    if (aliasExists) {
      const currentIndices = await clientArgs.client.cat.aliases({
        name: elasticIndexAlias,
        format: 'json',
      });

      for (const index of currentIndices) {
        if (index.index) {
          indexesToRemove.push(index.index);
        }
        actions.push({
          remove: { index: index.index, alias: elasticIndexAlias },
        });
      }
    }

    // Execute -- update the alias (remove from old indices and add to new index)
    await clientArgs.client.indices.updateAliases({
      body: { actions },
    });

    console.log(
      `Alias ${elasticIndexAlias} is now pointing to ${realIndexName}`,
    );

    // delete the old indexes
    for (const index of indexesToRemove) {
      await clientArgs.client.indices.delete({ index });
      console.log(`Deleted old index: ${index}`);
    }
  } catch (error) {
    console.error(`Failed to create/update alias:`, error);
  }
};

// const vectorStore = new ElasticVectorSearch(embeddings, clientArgs);
const processIntoDocuments = async (documents: KbDocument[]) => {
  const processedDocuments = documents.map((document) => {
    // append the title to the top of the text since it might be helpful in searching
    const textWithTitle = `${document.title} ${document.content}`;

    return new Document({
      pageContent: textWithTitle,
      metadata: { id: document.id, title: document.title, url: document.url },
    });
  });

  //   console.log('textOnly', textOnly, metadata);

  // split the documents into chunks
  // TODO: play with chunk size & overlap
  // TODO: this doesn't work too well with content in tables
  const textSplitter = new RecursiveCharacterTextSplitter();

  const splitDocs = await textSplitter.splitDocuments(processedDocuments);

  console.log('storing in elastic split docs: ', splitDocs.length);

  // batch the splitDocs into 200 at a time
  const batchedSplitDocs = [];

  for (let i = 0; i < splitDocs.length; i += 200) {
    batchedSplitDocs.push(splitDocs.slice(i, i + 200));
  }

  // store the docs in batches in our tmp index
  for (const batch of batchedSplitDocs) {
    console.log('storing batch size: ', batch.length);
    await ElasticVectorSearch.fromDocuments(batch, embeddings, clientArgs);
  }

  // now that we have stored all the documents, we can update the alias and delete the old index
  await createAndUpdateAlias();

  // we now have a new index with the documents stored and our alias points to it
  console.log('storage complete');
};

// read all kb documents from the data folder
const loadKbDocuments = async (path: string) => {
  const files = await fs.promises.readdir(path);

  const docs: KbDocument[] = [];

  for (const file of files) {
    const fileContents = await fs.promises.readFile(`${path}/${file}`, 'utf8');

    const doc = JSON.parse(fileContents);

    docs.push(doc);
  }

  return docs;
};

const main = async () => {
  const docs = await loadKbDocuments('./data');

  console.log('doc count: ', docs.length);

  await processIntoDocuments(docs);
};

main()
  .then(() => {
    console.log('Done');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

interface KbDocument {
  sys_id: string;
  id: string;
  title: string;
  url: string;
  content: string;
}
