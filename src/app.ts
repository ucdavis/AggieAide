// Require the Bolt package (github.com/slackapi/bolt)
import { Client, ClientOptions } from '@elastic/elasticsearch';
import {
  App,
  AckFn,
  RespondArguments,
  SlashCommand,
  RespondFn,
} from '@slack/bolt';
import dotenv from 'dotenv';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import {
  ElasticClientArgs,
  ElasticVectorSearch,
} from 'langchain/vectorstores/elasticsearch';
import OpenAI from 'openai';
import { ChatCompletionTool } from 'openai/resources/chat/completions';

dotenv.config();

const openai = new OpenAI();

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

const embeddings = new OpenAIEmbeddings();

// get my vector store
const config: ClientOptions = {
  node: process.env.ELASTIC_URL ?? 'http://127.0.0.1:9200',
  auth: {
    username: process.env.ELASTIC_SEARCHER_USERNAME ?? 'elastic',
    password: process.env.ELASTIC_SEARCHER_PASSWORD ?? 'changeme',
  },
};

const clientArgs: ElasticClientArgs = {
  client: new Client(config),
  indexName: process.env.ELASTIC_INDEX ?? 'test_vectorstore4',
  vectorSearchOptions: {
    similarity: 'cosine', // since this is what openAI uses
  },
};

const handleSlashCommand = async ({
  ack,
  payload,
  respond,
  modelName,
}: {
  ack: AckFn<string | RespondArguments>;
  payload: SlashCommand;
  respond: RespondFn;
  modelName: string;
}) => {
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
      `Knowledge Base Bot v0.1-beta by Scott Kirkland. model ${modelName}, elastic search dense vector + cosine, recursive character vectorization. Getting an answer to your question...`,
    );

    // get ask our AI
    const response = await getResponse(payloadText, modelName);

    // get back our structured response
    console.log('response', response);

    // convert to slack blocks
    const blocks = convertToBlocks(response);

    // update the message with the response
    await respond({
      blocks: blocks,
    });
  } catch (error) {
    console.error(error);
  }
};

app.command('/kb3', async ({ ack, payload, respond }) => {
  const modelName = 'gpt-3.5-turbo-1106';

  await handleSlashCommand({ ack, payload, respond, modelName });
});

app.command('/kb', async ({ ack, payload, respond }) => {
  const modelName = 'gpt-4-1106-preview'; // GPT-4 Turbo

  await handleSlashCommand({ ack, payload, respond, modelName });
});

const convertToBlocks = (content: AnswerQuestionFunctionArgs[]) => {
  // Constructing Slack message blocks
  const messageBlocks = [];

  for (const answer of content) {
    messageBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: answer.content,
      },
    });

    if (answer.citations.length > 0) {
      messageBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Citations*',
        },
      });

      answer.citations.forEach((citation) => {
        messageBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<${citation.url}|${citation.title}>`,
          },
        });
      });
    }
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

const getResponse = async (query: string, modelName: string) => {
  // assume the index is already created
  const search = await ElasticVectorSearch.fromExistingIndex(
    embeddings,
    clientArgs,
  );

  // get our search results
  // TODO: can use similarity score to filter out low confidence results
  const relevantDocs = await search.similaritySearchWithScore(query, 5);

  // result is array of arrays, with each array containing the document [0] and the similarity score [1]

  // console.log('relevantDocs', relevantDocs);

  // Each document should be delimited by triple quotes and then note the excerpt of the document
  const docText = relevantDocs.map((docWithScore) => {
    const doc = docWithScore[0];
    return `"""${doc.pageContent}\n\n-from <${getKbLink(
      doc.metadata.id,
    )}|${cleanupTitle(doc.metadata.title)}>"""`;
  });

  // console.log('docText', docText);

  // construct our tool function which defines the expected output structure
  const tools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'answer_question',
        description: 'Answer a question and provide citations',
        parameters: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description:
                'The content of the answer to the question, in markdown format',
            },
            citations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'The title of the document cited',
                  },
                  url: {
                    type: 'string',
                    format: 'uri',
                    description: 'The url of the document cited',
                  },
                },
                required: ['title', 'url'],
                additionalProperties: false,
              },
            },
          },
          required: ['content', 'citations'],
          additionalProperties: false,
        },
      },
    },
  ];

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: 'system',
        content: `
        You are a helpful assitant and will be provided with several documents each delimited by triple quotes and then asked a question.
      Your task is to answer the question in nicely formatted markdown using only the provided documents and to cite the the documents used to answer the question. 
      If the documents do not contain the information needed to answer this question then simply write: "Insufficient information to answer this question." 
      If an answer to the question is provided, it must be annotated with a citation. Only call 'answer_question' once after your entire answer has been formulated. \n\n ${docText}`,
      },
      {
        role: 'user',
        content: 'Question: ' + query,
      },
    ],
    temperature: 0.2, // play with this to get more consistent results
    tools: tools,
    tool_choice: { type: 'function', function: { name: 'answer_question' } },
  });

  // get the most recent message
  const responseMessage = response.choices[0].message;

  console.log('responseMessage', responseMessage);

  // Step 2: check if the model wanted to call a function
  const toolCalls = responseMessage.tool_calls;

  if (toolCalls) {
    // we have a tool call. should only be one but let's loop anyway and build up our response
    // console.log('toolCalls', toolCalls);
    return toolCalls.map((toolCall) => {
      return JSON.parse(
        toolCall.function.arguments,
      ) as AnswerQuestionFunctionArgs;
    });
  } else {
    // our function wasn't called -- don't think that should happen?
    return [
      {
        content:
          'sorry, something went wrong trying to answer your question.  Please try again.',
        citations: [],
      },
    ];
  }
};

(async () => {
  // Start your app
  const port = process.env.PORT || 3000;
  await app.start(port);

  console.log(`⚡️ Bolt app is running at ${port}`);
})();

interface AnswerQuestionFunctionArgs {
  content: string;
  citations: {
    title: string;
    url: string;
  }[];
}
