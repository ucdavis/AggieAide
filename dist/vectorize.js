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
const elasticsearch_1 = require("@elastic/elasticsearch");
const elasticsearch_2 = require("langchain/vectorstores/elasticsearch");
const openai_1 = require("langchain/embeddings/openai");
const text_splitter_1 = require("langchain/text_splitter");
const document_1 = require("langchain/document");
const exceljs_1 = __importDefault(require("exceljs"));
const html_to_text_1 = require("html-to-text");
const compiledConvert = (0, html_to_text_1.compile)(); // options could be passed here
// let's try to do full RAG with OpenAI assistants & ElasticSearch
const apiKey = process.env.OPENAI_API_KEY; // Replace with your API key or use environment variable
if (!apiKey) {
    console.error('OpenAI API key is required');
    process.exit(1);
}
// embeddings
const embeddings = new openai_1.OpenAIEmbeddings();
// get my vector store
const config = {
    node: (_a = process.env.ELASTIC_URL) !== null && _a !== void 0 ? _a : 'http://127.0.0.1:9200',
};
const clientArgs = {
    client: new elasticsearch_1.Client(config),
    indexName: (_b = process.env.ELASTIC_INDEX) !== null && _b !== void 0 ? _b : 'test_vectorstore2',
};
// const vectorStore = new ElasticVectorSearch(embeddings, clientArgs);
const processIntoDocuments = (documents) => __awaiter(void 0, void 0, void 0, function* () {
    const processedDocuments = documents.map((document) => {
        const text = compiledConvert(document.htmlContent);
        // append the title to the top of the text since it might be helpful in searching
        const textWithTitle = `${document.title} ${text}`;
        return new document_1.Document({
            pageContent: textWithTitle,
            metadata: { id: document.id, title: document.title },
        });
    });
    //   console.log('textOnly', textOnly, metadata);
    // split the documents into chunks
    // TODO: play with chunk size & overlap
    const textSplitter = new text_splitter_1.RecursiveCharacterTextSplitter({
        chunkSize: 256,
        chunkOverlap: 20,
    });
    const splitDocs = yield textSplitter.splitDocuments(processedDocuments);
    console.log('storing in elastic');
    // batch the splitDocs into 200 at a time
    const batchedSplitDocs = [];
    for (let i = 0; i < splitDocs.length; i += 200) {
        batchedSplitDocs.push(splitDocs.slice(i, i + 200));
    }
    // store the docs in batches
    for (const batch of batchedSplitDocs) {
        console.log('storing batch size: ', batch.length);
        yield elasticsearch_2.ElasticVectorSearch.fromDocuments(batch, embeddings, clientArgs);
    }
    console.log('storage complete');
});
// get back the rows from the excel file
const processExcel = (path) => __awaiter(void 0, void 0, void 0, function* () {
    const workbook = new exceljs_1.default.Workbook();
    yield workbook.xlsx.readFile(path);
    const sheet = workbook.getWorksheet(1);
    if (!sheet) {
        throw new Error('Sheet not found');
    }
    const documents = [];
    sheet.eachRow((row) => __awaiter(void 0, void 0, void 0, function* () {
        var _c, _d, _e, _f, _g, _h;
        const id = (_d = (_c = row.getCell('A').value) === null || _c === void 0 ? void 0 : _c.toString()) !== null && _d !== void 0 ? _d : '';
        const title = (_f = (_e = row.getCell('E').value) === null || _e === void 0 ? void 0 : _e.toString()) !== null && _f !== void 0 ? _f : '';
        const htmlContent = (_h = (_g = row.getCell('J').value) === null || _g === void 0 ? void 0 : _g.toString()) !== null && _h !== void 0 ? _h : '';
        documents.push({
            id,
            title,
            htmlContent,
            text: '',
        });
    }));
    return documents;
});
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    const docs = yield processExcel('/Users/postit/Documents/projects/kb-bot/docs/kb_knowledge.xlsx');
    console.log('doc count: ', docs.length);
    yield processIntoDocuments(docs);
});
main()
    .then(() => {
    console.log('Done');
})
    .catch((err) => {
    console.error(err);
    process.exit(1);
});
