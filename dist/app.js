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
Object.defineProperty(exports, "__esModule", { value: true });
// Require the Bolt package (github.com/slackapi/bolt)
const bolt_1 = require("@slack/bolt");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = new bolt_1.App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});
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
            // wait 2 seconds and update the message using chat.update
            yield new Promise((r) => setTimeout(r, 2000));
            yield app.client.chat.update({
                token: context.botToken,
                channel: payload.channel_id,
                ts: messageInitial.ts,
                text: 'Hello world! (updated)',
            });
        }
    }
    catch (error) {
        console.error(error);
    }
}));
(() => __awaiter(void 0, void 0, void 0, function* () {
    // Start your app
    const port = process.env.PORT || 3000;
    yield app.start(port);
    console.log(`⚡️ Bolt app is running at ${port}`);
}))();
