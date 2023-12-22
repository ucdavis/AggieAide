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
const openai_2 = require("langchain/chat_models/openai");
const output_parser_1 = require("langchain/schema/output_parser");
const prompts_1 = require("langchain/prompts");
const runnable_1 = require("langchain/schema/runnable");
;
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
const modelName = 'gpt-3.5-turbo-1106'; // gpt-4
const model = new openai_2.ChatOpenAI({ modelName: modelName }).pipe(new output_parser_1.StringOutputParser());
const embeddings = new openai_1.OpenAIEmbeddings();
// get my vector store
const config = {
    node: (_a = process.env.ELASTIC_URL) !== null && _a !== void 0 ? _a : 'http://127.0.0.1:9200',
};
const clientArgs = {
    client: new elasticsearch_1.Client(config),
    indexName: (_b = process.env.ELASTIC_INDEX) !== null && _b !== void 0 ? _b : 'test_vectorstore4',
    vectorSearchOptions: {
        similarity: 'cosine', // since this is what openAI uses
    },
};
app.command('/kb', ({ ack, payload, respond }) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield ack();
        const payloadText = payload.text;
        if (!payloadText) {
            yield respond('You can ask me anything about the knowledge base. ex: /kb how to create a new user?');
            return;
        }
        // send a message using chat.postMessage
        yield respond('Querying the knowledge base...');
        // get ask our AI
        const response = yield getResponse(payloadText);
        // const response = 'testing';
        // update the message with the response
        yield respond({
            text: response,
        });
    }
    catch (error) {
        console.error(error);
    }
}));
const getResponse = (query) => __awaiter(void 0, void 0, void 0, function* () {
    // assume the index is already created
    const search = yield elasticsearch_2.ElasticVectorSearch.fromExistingIndex(embeddings, clientArgs);
    const combineDocumentsPrompt = prompts_1.ChatPromptTemplate.fromMessages([
        prompts_1.AIMessagePromptTemplate.fromTemplate(`You will be provided with documents delimited by triple quotes and a question. 
      Your task is to answer the question using only the provided documents and to cite the passage(s) of the documents used to answer the question. 
      If the documents do not contain the information needed to answer this question then simply write: "Insufficient information." 
      If an answer to the question is provided, it must be annotated with citations. Use the following format for to cite relevant passages ({"citation": …, "url": ...}).
      \n\n{context}
      `),
        prompts_1.HumanMessagePromptTemplate.fromTemplate('Question: {question}'),
    ]);
    // array of kb numbers that are relevant
    let kbDocs = [];
    const combineDocumentsChain = runnable_1.RunnableSequence.from([
        {
            question: (output) => output,
            context: (output) => __awaiter(void 0, void 0, void 0, function* () {
                const relevantDocs = yield search
                    .asRetriever({
                    k: 5,
                })
                    .getRelevantDocuments(output);
                kbDocs = relevantDocs.map((doc) => ({
                    id: doc.metadata.id,
                    title: doc.metadata.title,
                }));
                console.log('relevantDocs', relevantDocs);
                // Each document should be delimited by triple quotes and then note the excerpt of the document
                const docText = relevantDocs.map((doc) => {
                    return `"""${doc.metadata.title}\n\n-Excerpted from "${doc.metadata.title}" at ${getKbLink(doc.metadata.id)}"""`;
                });
                console.log('docText', docText);
                return docText.join('\n\n');
            }),
        },
        combineDocumentsPrompt,
        model,
        new output_parser_1.StringOutputParser(),
    ]);
    const result = yield combineDocumentsChain.invoke(query);
    const uniqueIds = new Set();
    kbDocs = kbDocs.filter((doc) => {
        if (!uniqueIds.has(doc.id)) {
            uniqueIds.add(doc.id);
            return true;
        }
        return false;
    });
    const getKbLink = (kbNumber) => {
        return `https://servicehub.ucdavis.edu/servicehub?id=ucd_kb_article&sysparm_article=${kbNumber}`;
    };
    const resultWithLinks = result +
        '\n\n' +
        'Relevant KB Articles: \n\n' +
        kbDocs.map((doc) => `<${getKbLink(doc.id)}|${doc.title}>`).join('\n');
    return resultWithLinks;
});
(() => __awaiter(void 0, void 0, void 0, function* () {
    // Start your app
    const port = process.env.PORT || 3000;
    yield app.start(port);
    console.log(`⚡️ Bolt app is running at ${port}`);
}))();
