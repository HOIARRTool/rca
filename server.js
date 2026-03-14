const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/generate', async (req, res) => {
    const userPrompt = req.body.prompt;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("Error: API Key is missing");
        return res.status(500).json({ error: { message: "API Key not configured on server." } });
    }

    // --- กลับมาใช้ gemini-2.5-flash ตามที่คุณต้องการ ---
    // ใช้ v1beta เพราะรุ่นใหม่ๆ มักจะอยู่ใน beta channel
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // ตั้งค่าปิด Safety Filter ทั้งหมด เพื่อให้คุยเรื่อง RCA การแพทย์/อุบัติเหตุได้
    const payload = {
        contents: [{ parts: [{ text: userPrompt }] }],
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // เช็ค Error จาก Google
        if (!response.ok) {
            console.error("Gemini API Error:", JSON.stringify(data, null, 2));
            
            // ถ้าเจอ Error 429 (Too Many Requests / Quota Exceeded) ให้แจ้ง User ชัดๆ
            if (response.status === 429) {
                throw new Error("ใจเย็นๆ ครับ! โควต้าเต็ม (Quota Exceeded) กรุณารอสัก 1 นาทีแล้วกดใหม่ครับ");
            }
            
            throw new Error(data.error?.message || `API Error: ${data.error?.code}`);
        }

        // เช็คกรณี AI บล็อคเนื้อหา
        if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
             console.error("AI blocked response:", JSON.stringify(data, null, 2));
             throw new Error("AI refused to generate content (Safety Blocked).");
        }

        res.json(data);

    } catch (error) {
        console.error("Server Internal Error:", error);
        res.status(500).json({ error: { message: error.message } });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
