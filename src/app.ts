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
import { formatDocumentsAsString } from 'langchain/util/document';

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

const modelName = 'gpt-3.5-turbo-1106'; // gpt-4

const model = new ChatOpenAI({ modelName: modelName }).pipe(
  new StringOutputParser(),
);

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

app.command('/kb', async ({ ack, payload, context, say }) => {
  try {
    await ack();

    const payloadText = payload.text;

    if (!payloadText) {
      await say(
        'You can ask me anything about the knowledge base. ex: /kb how to create a new user?',
      );
      return;
    }

    // send a message using chat.postMessage
    const messageInitial = await say('Querying the knowledge base...');

    if (messageInitial.ok && messageInitial.ts) {
      // get ask our AI
      const response = await getResponse(payloadText);

      await app.client.chat.update({
        token: context.botToken,
        channel: payload.channel_id,
        ts: messageInitial.ts,
        text: response,
      });
    }
  } catch (error) {
    console.error(error);
  }
});

const getResponse = async (query: string) => {
  // assume the index is already created
  const search = await ElasticVectorSearch.fromExistingIndex(
    embeddings,
    clientArgs,
  );

  const combineDocumentsPrompt = ChatPromptTemplate.fromMessages([
    AIMessagePromptTemplate.fromTemplate(
      "Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.\n\n{context}\n\n",
    ),
    HumanMessagePromptTemplate.fromTemplate('Question: {question}'),
  ]);

  // array of kb numbers that are relevant
  let kbDocs: KbDocument[] = [];

  const combineDocumentsChain = RunnableSequence.from([
    {
      question: (output: string) => output,
      context: async (output: string) => {
        const relevantDocs = await search
          .asRetriever({
            k: 5,
          })
          .getRelevantDocuments(output);

        kbDocs = relevantDocs.map((doc) => ({
          id: doc.metadata.id,
          title: doc.metadata.title,
        }));

        console.log('relevantDocs', relevantDocs);
        // console.log(
        //   'relevantDocs as string',
        //   formatDocumentsAsString(relevantDocs),
        // );
        console.log(
          'combined prompt',
          await combineDocumentsPrompt.invoke({
            context: formatDocumentsAsString(relevantDocs),
            question: query,
          }),
        );
        return formatDocumentsAsString(relevantDocs);
      },
    },
    combineDocumentsPrompt,
    model,
    new StringOutputParser(),
  ]);

  const result = await combineDocumentsChain.invoke(query);

  const uniqueIds = new Set();
  kbDocs = kbDocs.filter((doc) => {
    if (!uniqueIds.has(doc.id)) {
      uniqueIds.add(doc.id);
      return true;
    }
    return false;
  });

  const getKbLink = (kbNumber: string) => {
    return `https://servicehub.ucdavis.edu/servicehub?id=ucd_kb_article&sysparm_article=${kbNumber}`;
  };

  const resultWithLinks =
    result +
    '\n\n' +
    'Relevant KB Articles: \n\n' +
    kbDocs.map((doc) => `<${getKbLink(doc.id)}|${doc.title}>`).join('\n');

  return resultWithLinks;
};

(async () => {
  // Start your app
  const port = process.env.PORT || 3000;
  await app.start(port);

  console.log(`⚡️ Bolt app is running at ${port}`);
})();

interface KbDocument {
  id: string;
  title: string;
  htmlContent?: string;
  text?: string;
}
