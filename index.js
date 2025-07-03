const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
require('dotenv').config(); // โหลดค่าจากไฟล์ .env

// สร้างเซิร์ฟเวอร์ Express
const app = express();

// ข้อมูลเซิร์ฟเวอร์
const serverInfo = {
    environment: process.env.APP_MODE || "unknown",
    service: process.env.APP_NAME || "unnamedService",
    version: process.env.APP_VERSION || "v1.0.0"
};

// สร้าง response
const createResponse = (status, req) => ({
    status,
    ...serverInfo,
    userAgent: req.headers['user-agent'] || 'unknown',
    // ดึง IP จริงจาก Cloudflare ผ่าน x-forwarded-for
    ipAddress: req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip,
    ipType: (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip).includes(':') ? 'IPv6' : 'IPv4'
});

// Redirect HTTP ไป HTTPS
app.use((req, res, next) => {
    if (!req.secure) {
        return res.redirect('https://' + req.headers.host + req.url);
    }
    next();
});

// ส่งกลับ 404 สำหรับเส้นทางอื่น ๆ
app.use((req, res) => {
    res.status(404).json(createResponse("error", req));
});

// สร้างเซิร์ฟเวอร์ HTTP สำหรับการ redirect ไป HTTPS
http.createServer(app).listen(80, () => {
    console.log('HTTP server started on port 80 and will redirect to HTTPS');
});

// ตรวจสอบว่าไฟล์ SSL key และ cert มีอยู่จริงก่อนสร้าง HTTPS server
if (fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
    const options = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8')
    };
    https.createServer(options, app).listen(443, () => {
        console.log('HTTPS server started on port 443 with SSL');
    });
} else {
    console.error('SSL key or certificate not found. HTTPS server not started.');
}

// จัดการข้อผิดพลาดที่ไม่ได้จัดการ
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);
