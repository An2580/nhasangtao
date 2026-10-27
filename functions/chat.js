export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            // Tự động nhận diện Key nào đang có trên Cloudflare
            const openAiKey = env.OPENAI_API_KEY;
            const geminiKey = env.GEMINI_API_KEY;
            const apiKey = openAiKey || geminiKey;

            if (!apiKey) {
                return new Response(JSON.stringify({ code: 'nokey', error: 'Chưa cấu hình API Key trên Cloudflare' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const body = await request.json();
            const messages = body.messages || [];

            let reply = '';

            // NẾU LÀ KEY OPENAI (Bắt đầu bằng sk-)
            if (openAiKey) {
                const formattedMessages = messages.map(m => ({
                    role: m.role === 'model' ? 'assistant' : (m.role || 'user'),
                    content: m.text
                }));

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openAiKey}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-3.5-turbo',
                        messages: formattedMessages
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    return new Response(JSON.stringify({ code: 'key', error: data.error?.message }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                reply = data.choices?.[0]?.message?.content;
            } 
            // NẾU LÀ KEY GEMINI (Bắt đầu bằng AIzaSy)
            else {
                const contents = messages.map(m => ({
                    role: m.role === 'model' ? 'model' : 'user',
                    parts: [{ text: m.text }]
                }));

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents })
                });

                const data = await response.json();
                if (!response.ok) {
                    return new Response(JSON.stringify({ code: 'key', error: data.error?.message }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
            }

            if (!reply) {
                return new Response(JSON.stringify({ code: 'empty', error: 'Không nhận được phản hồi từ AI' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ reply }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            return new Response(JSON.stringify({ code: 'network', error: error.message }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};

export async function onRequestPost(context) {
    return exports.default.fetch(context.request, context.env);
}
