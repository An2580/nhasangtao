export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        
        // Lấy API Key bảo mật từ cài đặt Environment variables của Cloudflare
        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ code: 'nokey' }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        const body = await request.json();
        const messages = body.messages || [];

        // Chuyển đổi lịch sử chat sang định dạng chuẩn của Gemini API (contents)
        const contents = messages.map(m => ({
            role: m.role === 'model' ? 'model' : 'user',
            parts: [{ text: m.text }]
        }));

        // Gọi sang mô hình Gemini (dùng gemini-1.5-flash tốc độ nhanh và ổn định)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents })
        });

        const data = await response.json();

        if (!response.ok) {
            const status = response.status;
            let code = status;
            if (status === 403 || status === 400) code = 'key';
            if (status === 429) code = 'quota';
            return new Response(JSON.stringify({ code }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Trích xuất câu trả lời từ Gemini trả về cho widget trên web
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!reply) {
            return new Response(JSON.stringify({ code: 'empty' }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({ reply }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ code: 'network' }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    }
}
