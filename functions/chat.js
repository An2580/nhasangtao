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

    // 2. Lấy dữ liệu tin nhắn gửi từ trang web
    const requestData = await context.request.json();
    
    // Chuyển đổi lịch sử chat sang định dạng của Google Gemini
    let geminiContents = [];
    if (requestData.messages && Array.isArray(requestData.messages)) {
      geminiContents = requestData.messages.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));
    } else {
      const userPrompt = requestData.prompt || "Chào bạn!";
      geminiContents = [{ role: "user", parts: [{ text: userPrompt }] }];
    }

    // 3. Gọi API Google AI Studio (Model gemini-1.5-flash miễn phí & cực nhanh)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const apiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: geminiContents
      })
    });

    const data = await apiResponse.json();

    // Lấy câu trả lời từ Gemini
    let replyText = "Không nhận được phản hồi từ AI.";
    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
      replyText = data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      replyText = `Lỗi Gemini API: ${data.error.message}`;
    }

    // 4. Trả kết quả chuẩn về cho khung chat giao diện web
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: replyText
            }
          }
        ]
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
