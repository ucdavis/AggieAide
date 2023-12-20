// Require the Bolt package (github.com/slackapi/bolt)
import { Client, ClientOptions } from '@elastic/elasticsearch';
import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import {
  ElasticClientArgs,
  ElasticVectorSearch,
} from 'langchain/vectorstores/elasticsearch';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const embeddings = new OpenAIEmbeddings();

// get my vector store
const config: ClientOptions = {
  node: process.env.ELASTIC_URL ?? 'http://127.0.0.1:9200',
};
const clientArgs: ElasticClientArgs = {
  client: new Client(config),
  indexName: process.env.ELASTIC_INDEX ?? 'test_vectorstore2',
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
      await new Promise((r) => setTimeout(r, 2000));

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

  console.log('searching for ', query);

  // use db to retrieve matches
  const searchResults = await search.similaritySearchWithScore(query, 3);

  console.log('searchResults', JSON.stringify(searchResults, null, 2));

  // pull out the kbIds
  const kbIds: string[] = searchResults.map(
    (result) => result[0].metadata.id as string,
  );

  console.log('kbIds', kbIds);

  // remove dupes
  const uniqueIds = [...new Set(kbIds)];

  console.log('uniqueIds', uniqueIds);

  return 'text';
};

(async () => {
  // Start your app
  const port = process.env.PORT || 3000;
  await app.start(port);

  console.log(`⚡️ Bolt app is running at ${port}`);
})();
