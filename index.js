const express = require('express');
const proxy = require('express-http-proxy');
const http = require('http');
const https = require('https');
const fs = require('fs');
require('dotenv').config(); // Load values from .env
const { createProxyMiddleware } = require('http-proxy-middleware'); // Import the middleware

// Create Express server
const app = express();

// Server info
const serverInfo = {
    environment: process.env.APP_MODE || "unknown",
    service: process.env.APP_NAME || "unnamedService",
    version: process.env.APP_VERSION || "v1.0.0"
};

// Create response
const createResponse = (status, req) => ({
    status,
    ...serverInfo,
    userAgent: req.headers['user-agent'] || 'unknown',
    ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip,
    ipType: (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip).includes(':') ? 'IPv6' : 'IPv4'
});

// Logging middleware
app.use((req, res, next) => {
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        console.log(`Incoming WebSocket request: ${req.method} ${req.url}`);
    } else {
        console.log(`Incoming request: ${req.method} ${req.url}`);
    }
    next();
});

// HTTP proxy middleware for '/api' endpoints
app.use('/api', proxy(process.env.API_PROXY_URL, {
    proxyReqPathResolver: (req) => {        
        return `${req.baseUrl}${req.url}`; // Include '/api' in the URL
    }
}));

// 404 handler
app.use((req, res) => {
    res.status(404).json(createResponse("error", req));
});

// Create WebSocket proxy middleware
const wsProxy = createProxyMiddleware({
    target: 'ws://0.0.0.0:8080',
    ws: true,
    changeOrigin: true,
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
        // Copy headers 1:1 from client to server
        for (let header in req.headers) {
            proxyReq.setHeader(header, req.headers[header]);
        }
    },
});

// Create HTTP server
const httpServer = http.createServer(app);

// Handle WebSocket upgrades on the HTTP server
httpServer.on('upgrade', (req, socket, head) => {
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        wsProxy.upgrade(req, socket, head);
    }
});

httpServer.listen(80, () => {
    console.log('Server started on port 80 (HTTP)');
});

// Check for SSL certificates and create HTTPS server if available
if (fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
    const options = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8')
    };
    const httpsServer = https.createServer(options, app);

    // Handle WebSocket upgrades on the HTTPS server
    httpsServer.on('upgrade', (req, socket, head) => {
        if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
            wsProxy.upgrade(req, socket, head);
        }
    });

    httpsServer.listen(443, () => {
        console.log('Server started on port 443 with SSL (HTTPS)');
    });
} else {
    console.error('SSL key or certificate not found. HTTPS server not started.');
}

// Error handling
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);
