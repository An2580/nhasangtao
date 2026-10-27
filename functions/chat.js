export async function onRequestPost(context) {
    const { request, env } = context;
    
    try {
        // Lấy API Key từ biến môi trường trên Cloudflare (ưu tiên OPENAI_API_KEY)
        const apiKey = env.OPENAI_API_KEY || env.GEMINI_API_KEY;
        
        if (!apiKey) {
            return new Response(JSON.stringify({ 
                error: "Chưa cấu hình API Key trên Cloudflare (thiếu OPENAI_API_KEY)." 
            }), {
                status: 200,
                headers: { "Content-Type": "application/json; charset=utf-8" }
            });
        }

        const body = await request.json();
        const messages = body.messages || [];

        // Chuyển đổi lịch sử chat sang chuẩn của OpenAI
        const formattedMessages = messages.map(m => ({
            role: m.role === 'model' ? 'assistant' : (m.role || 'user'),
            content: m.text || m.content || ''
        }));

        // Gọi trực tiếp sang OpenAI API (gpt-3.5-turbo)
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: formattedMessages
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return new Response(JSON.stringify({ 
                error: data.error?.message || "Lỗi từ OpenAI API" 
            }), {
                status: 200,
                headers: { "Content-Type": "application/json; charset=utf-8" }
            });
        }

        const reply = data.choices?.[0]?.message?.content || "Không nhận được phản hồi từ AI.";

        return new Response(JSON.stringify({ reply }), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ 
            error: "Lỗi hệ thống: " + err.message 
        }), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" }
        });
    }
}

// Dự phòng tương thích chuẩn Cloudflare Worker
export default {
    async fetch(request, env) {
        if (request.method === 'POST') {
            return onRequestPost({ request, env });
        }
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { "Content-Type": "application/json; charset=utf-8" }
        });
    }
};
