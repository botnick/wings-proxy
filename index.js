const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
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
    ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip,
    ipType: (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip).includes(':') ? 'IPv6' : 'IPv4'
});

// เส้นทางหลัก '/'
app.get('/', (req, res) => {
    res.json(createResponse("success", req));
});

// Logging middleware
app.use((req, res, next) => {
    console.log(`Request: ${req.method} ${req.originalUrl}`);
    console.log('Request Headers:', req.headers);
  next();
});
   

app.use('api/*', createProxyMiddleware({
    target: 'http://0.0.0.0:8080', // เปลี่ยนเป็น URL ที่คุณต้องการ
    changeOrigin: true,
    ws: true, // รองรับ WebSocket
    onProxyReq: (proxyReq, req, res) => {
      // ส่ง headers จาก client ไปยังปลายทางแบบ 1:1
      Object.keys(req.headers).forEach((key) => {
        proxyReq.setHeader(key, req.headers[key]);
      });
  
      // ตั้งค่า headers เพิ่มเติมตามที่ Nginx กำหนด
      proxyReq.setHeader('X-Forwarded-For', req.headers['x-forwarded-for'] || req.connection.remoteAddress);
      proxyReq.setHeader('X-Real-IP', req.connection.remoteAddress);
      proxyReq.setHeader('X-Forwarded-Proto', req.protocol);
      proxyReq.setHeader('Upgrade', req.headers['upgrade']);
      proxyReq.setHeader('Connection', 'upgrade');
  
      console.log(`Proxying request to: ${proxyReq.path}`);
      console.log('Request Headers sent to target:', req.headers);
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`Received response with status: ${proxyRes.statusCode}`);
      // แสดง headers ที่ได้รับจากปลายทาง
      console.log('Response Headers:', proxyRes.headers);
    },
    logLevel: 'debug',
}));

// จัดการข้อผิดพลาด 404
app.use('*', (req, res) => {
    res.status(404).json(createResponse("error", req));
});

// สร้างเซิร์ฟเวอร์ HTTP 
http.createServer(app).listen(80, () => {
    console.log('Server started on port 80 (HTTP)');
});

// ตรวจสอบว่าไฟล์ SSL key และ cert มีอยู่จริงก่อนสร้าง HTTPS server
if (fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
    const options = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8')
    };

    https.createServer(options, app).listen(443, () => {
        console.log('Server started on port 443 with SSL (HTTPS)');
    });
} else {
    console.error('SSL key or certificate not found. HTTPS server not started.');
}

// จัดการข้อผิดพลาดที่ไม่ได้จัดการ
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);
