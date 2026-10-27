export async function onRequestPost(context) {
  try {
    // 1. Lấy API Key từ Environment Variables trên Cloudflare Pages
    const apiKey = context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Chưa cấu hình OPENAI_API_KEY trên Cloudflare." }),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // 2. Nhận dữ liệu câu hỏi từ phía giao diện web (index.html)
    const requestData = await context.request.json();
    const userMessages = requestData.messages || [
      { role: "user", content: requestData.prompt || "Chào bạn!" }
    ];

    // 3. Gọi API của TokenPlus với mô hình Claude 3.5 Sonnet
    // (TokenPlus hỗ trợ giao thức dạng OpenAI-compatible)
    const apiResponse = await fetch("https://api.tokenplus.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20240620", // Bạn có thể đổi thành "claude-3-haiku-20240307" nếu muốn rẻ/nhanh hơn
        messages: userMessages,
        stream: false
      })
    });

    const data = await apiResponse.json();

    // 4. Trả kết quả về cho giao diện khung chat
    return new Response(JSON.stringify(data), {
      status: apiResponse.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Lỗi xử lý server: " + err.message }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
}
