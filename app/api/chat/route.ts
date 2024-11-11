import OpenAI from "openai";
import { DataAPIClient } from "@datastax/astra-db-ts";

const {
    ASTRA_DB_NAMESPACE,
    ASTRA_DB_COLLECTION,
    ASTRA_DB_API_ENDPOINT,
    ASTRA_DB_APPLICATION_TOKEN,
    OPENAI_API_KEY,
} = process.env;

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);
const db = client.db(ASTRA_DB_API_ENDPOINT, { namespace: ASTRA_DB_NAMESPACE });

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();
        const latestMessage = messages[messages?.length - 1]?.content;

        let docContext = "";

        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: latestMessage,
            encoding_format: "float",
        });

        const embedding = embeddingResponse.data[0].embedding;

        try {
            const collection = await db.collection(ASTRA_DB_COLLECTION);
            const cursor = collection.find(null, {
                sort: {
                    $vector: embedding,
                },
                limit: 10,
            });

            const documents = await cursor.toArray();
            const docsMap = documents?.map((doc) => doc.text);
            docContext = JSON.stringify(docsMap);
        } catch (err) {
            console.log("Error querying db...");
            docContext = "";
        }

        const template = {
            role: "system",
            content: `You are an AI assistant who knows everything about Formula One.
            Use the below context to augment what you know about Formula One racing.
            The content will provide you with the most recent page data from Wikipedia,
            the official F1 website, and others.
            If the content doesn't include the information you need, answer based on your
            existing knowledge without mentioning the source or limitations.
            Format responses using markdown where applicable, and avoid returning images.
        ----------------
        START CONTEXT
        ${docContext}
        END CONTEXT
        ----------------
        QUESTION: ${latestMessage}
        ----------------
        `,
        };

        // Non-streaming completion request
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [template, ...messages],
        });

        // Extract the assistant's reply
        const reply = response.choices[0]?.message?.content || "";

        return new Response(reply, {
            headers: { "Content-Type": "text/plain" },
        });
    } catch (err) {
        throw err;
    }
}