"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
// Require the Bolt package (github.com/slackapi/bolt)
const elasticsearch_1 = require("@elastic/elasticsearch");
const bolt_1 = require("@slack/bolt");
const dotenv_1 = __importDefault(require("dotenv"));
const openai_1 = require("langchain/embeddings/openai");
const elasticsearch_2 = require("langchain/vectorstores/elasticsearch");
const openai_2 = __importDefault(require("openai"));
dotenv_1.default.config();
const app = new bolt_1.App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});
// let's try to do full RAG with OpenAI assistants & ElasticSearch
const openAIApiKey = process.env.OPENAI_API_KEY; // Replace with your API key or use environment variable
if (!openAIApiKey) {
    console.error('OpenAI API key is required');
    process.exit(1);
}
const openai = new openai_2.default();
const embeddings = new openai_1.OpenAIEmbeddings();
// get my vector store
const config = {
    node: (_a = process.env.ELASTIC_URL) !== null && _a !== void 0 ? _a : 'http://127.0.0.1:9200',
};
const clientArgs = {
    client: new elasticsearch_1.Client(config),
    indexName: (_b = process.env.ELASTIC_INDEX) !== null && _b !== void 0 ? _b : 'test_vectorstore2',
};
app.command('/kb', ({ ack, payload, context, say }) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield ack();
        const payloadText = payload.text;
        if (!payloadText) {
            yield say('You can ask me anything about the knowledge base. ex: /kb how to create a new user?');
            return;
        }
        // send a message using chat.postMessage
        const messageInitial = yield say('Querying the knowledge base...');
        if (messageInitial.ok && messageInitial.ts) {
            // get ask our AI
            const response = yield getResponse(payloadText);
            yield new Promise((r) => setTimeout(r, 2000));
            yield app.client.chat.update({
                token: context.botToken,
                channel: payload.channel_id,
                ts: messageInitial.ts,
                text: response,
            });
        }
    }
    catch (error) {
        console.error(error);
    }
}));
const getResponse = (query) => __awaiter(void 0, void 0, void 0, function* () {
    // assume the index is already created
    const search = yield elasticsearch_2.ElasticVectorSearch.fromExistingIndex(embeddings, clientArgs);
    console.log('searching for ', query);
    // use db to retrieve matches
    const searchResults = yield search.similaritySearchWithScore(query, 3);
    console.log('searchResults', JSON.stringify(searchResults, null, 2));
    // pull out the kbIds
    const kbIds = searchResults.map((result) => result[0].metadata.id);
    console.log('kbIds', kbIds);
    // remove dupes
    const uniqueIds = [...new Set(kbIds)];
    console.log('uniqueIds', uniqueIds);
    const systemPrompt = 'You are a helpful assistant to staff at the University of California, Davis.  Use the provided context to produce your answers, and if you are not able to answer from these files then say you do not know. ' +
        'Context: ' +
        searchResults.map((result) => result[0].pageContent).join(' ');
    return systemPrompt;
    //   const completion = await openai.chat.completions.create({
    //     messages: [
    //       {
    //         role: 'system',
    //         content: systemPrompt,
    //       },
    //       { role: 'user', content: query },
    //     ],
    //     model: 'gpt-3.5-turbo',
    //   });
    //   return completion.choices[0].message.content;
});
(() => __awaiter(void 0, void 0, void 0, function* () {
    // Start your app
    const port = process.env.PORT || 3000;
    yield app.start(port);
    console.log(`⚡️ Bolt app is running at ${port}`);
}))();
