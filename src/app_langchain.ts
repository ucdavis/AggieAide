// Require the Bolt package (github.com/slackapi/bolt)
import { Client, ClientOptions } from '@elastic/elasticsearch';
import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import {
  ElasticClientArgs,
  ElasticVectorSearch,
} from 'langchain/vectorstores/elasticsearch';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { StringOutputParser } from 'langchain/schema/output_parser';
import {
  ChatPromptTemplate,
  AIMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from 'langchain/prompts';
import { RunnableSequence } from 'langchain/schema/runnable';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// let's try to do full RAG with OpenAI assistants & ElasticSearch
const openAIApiKey = process.env.OPENAI_API_KEY; // Replace with your API key or use environment variable
if (!openAIApiKey) {
  console.error('OpenAI API key is required');
  process.exit(1);
}

// const modelName = 'gpt-3.5-turbo-1106';
// const modelName = 'gpt-4';
const modelName = 'gpt-4-1106-preview'; // GPT-4 Turbo

const model = new ChatOpenAI({
  modelName: modelName,
}).pipe(new StringOutputParser());

const embeddings = new OpenAIEmbeddings();

// get my vector store
const config: ClientOptions = {
  node: process.env.ELASTIC_URL ?? 'http://127.0.0.1:9200',
};
const clientArgs: ElasticClientArgs = {
  client: new Client(config),
  indexName: process.env.ELASTIC_INDEX ?? 'test_vectorstore4',
  vectorSearchOptions: {
    similarity: 'cosine', // since this is what openAI uses
  },
};

app.command('/kb', async ({ ack, payload, respond }) => {
  try {
    await ack();

    const payloadText = payload.text;

    if (!payloadText) {
      await respond(
        'You can ask me anything about the knowledge base. ex: /kb how to create a new user?',
      );
      return;
    }

    // send a message using chat.postMessage
    await respond(
      'Knowledge Base Bot v0.1-beta by Scott Kirkland. gpt-4, elastic search dense vector + cosine, recursive character vectorization. Getting an answer to your question...',
    );

    // get ask our AI
    const response = await getResponse(payloadText);

    console.log('response', response);

    const blocks = convertToBlocks(response);

    // update the message with the response
    await respond({
      blocks: blocks,
    });
  } catch (error) {
    console.error(error);
  }
});

// Function to extract and deduplicate JSON sections
const extractAndDeduplicateJSONSections = (text: string) => {
  try {
    const regex = /{[^}]*}/g;
    const allMatches = text.match(regex) || [];
    const uniqueJSONObjects = new Map();

    allMatches.forEach((jsonString) => {
      // strip out all the newlines and other whitespace
      jsonString = jsonString.replace(/(\r\n|\n|\r)/gm, '');
      jsonString = jsonString.replace(/\s+/g, ' ');
      console.log('jsonString', jsonString);
      const jsonObject = JSON.parse(jsonString);
      uniqueJSONObjects.set(jsonObject.url, jsonObject);
    });

    return Array.from(uniqueJSONObjects.values());
  } catch (error) {
    console.error(error);
    return [];
  }
};

const convertToBlocks = (text: string) => {
  // Extract the JSON sections and remove duplicates
  const citations = extractAndDeduplicateJSONSections(text);

  // Remove JSON sections from main text
  const mainText = text.replace(/{[^}]*}/g, '').trim();

  // Constructing Slack message blocks
  const messageBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (citations.length > 0) {
    messageBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Citations*',
      },
    });

    citations.forEach((citation) => {
      messageBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${citation.url}|${citation.title}>`,
        },
      });
    });
  }

  return messageBlocks;
};

const getKbLink = (kbNumber: string) => {
  return `https://servicehub.ucdavis.edu/servicehub?id=ucd_kb_article&sysparm_article=${kbNumber}`;
};

const cleanupTitle = (title: string) => {
  // replace any quotes
  return title.replace(/"/g, '');
};

const getResponse = async (query: string) => {
  // assume the index is already created
  const search = await ElasticVectorSearch.fromExistingIndex(
    embeddings,
    clientArgs,
  );

  const combineDocumentsPrompt = ChatPromptTemplate.fromMessages([
    AIMessagePromptTemplate.fromTemplate(
      `You will be provided with several documents each delimited by triple quotes and then a question. 
      Your task is to answer the question using only the provided documents and to cite the the documents used to answer the question. 
      If the documents do not contain the information needed to answer this question then simply write: "Insufficient information to answer this question." 
      If an answer to the question is provided, it must be annotated by citing the title and url. Use the following format for to cite relevant passages ({{"title": ..., "url": ... }}).
      \n\n{context}
      `,
    ),
    HumanMessagePromptTemplate.fromTemplate('Question: {question}'),
  ]);

  // array of kb numbers that are relevant
  // let kbDocs: KbDocument[] = [];

  const combineDocumentsChain = RunnableSequence.from([
    {
      question: (output: string) => output,
      context: async (output: string) => {
        const relevantDocs = await search
          .asRetriever({
            k: 5,
          })
          .getRelevantDocuments(output);

        // kbDocs = relevantDocs.map((doc) => ({
        //   id: doc.metadata.id,
        //   title: doc.metadata.title,
        // }));

        console.log('relevantDocs', relevantDocs);

        // Each document should be delimited by triple quotes and then note the excerpt of the document
        const docText = relevantDocs.map((doc) => {
          return `"""${doc.pageContent}\n\n-from <${getKbLink(
            doc.metadata.id,
          )}|${cleanupTitle(doc.metadata.title)}>"""`;
        });

        console.log('docText', docText);

        return docText.join('\n\n');
      },
    },
    combineDocumentsPrompt,
    model,
    new StringOutputParser(),
  ]);

  const result = await combineDocumentsChain.invoke(query);

  return result;
};

(async () => {
  // Start your app
  const port = process.env.PORT || 3000;
  await app.start(port);

  console.log(`⚡️ Bolt app is running at ${port}`);
})();

// interface KbDocument {
//   id: string;
//   title: string;
//   htmlContent?: string;
//   text?: string;
// }
