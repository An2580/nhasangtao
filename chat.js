export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const { prompt } = await request.json();

        // Lấy API Key được bảo mật an toàn bên trong Cloudflare
        const apiKey = env.GEMINI_API_KEY; 

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
