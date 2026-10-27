export async function onRequestPost(context) {
  try {
    // 1. Lấy API Key từ Environment Variables trên Cloudflare
    const apiKey = context.env.GEMINI_API_KEY || context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Chưa cấu hình API Key trên Cloudflare Pages." }),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // 2. Nhận dữ liệu câu hỏi từ phía giao diện web
    const requestData = await context.request.json();
    let geminiContents = [];
    if (requestData.messages && Array.isArray(requestData.messages)) {
      geminiContents = requestData.messages.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));
    } else {
      geminiContents = [{ role: "user", parts: [{ text: requestData.prompt || "Chào bạn!" }] }];
    }

    // 3. Gọi Google Gemini API với Header xác thực x-goog-api-key chuẩn cho key AQ...
    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

    const apiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim()
      },
      body: JSON.stringify({ contents: geminiContents })
    });

    const data = await apiResponse.json();

    let replyText = "Không nhận được phản hồi từ AI.";
    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
      replyText = data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      replyText = `Lỗi Gemini API: ${data.error.message}`;
    }

    // 4. Trả kết quả về cho khung chat Trợ lý AI An Gờ
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: replyText } }]
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Lỗi xử lý server: " + err.message }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
}
