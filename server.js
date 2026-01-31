require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const OllamaHealthChecker = require('./ollama-health-checker');

const app = express();
const PORT = process.env.PORT || 3000;

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
  'OLLAMA_URL',
  'WAKE_COMPUTER_URL', 
  'WAKE_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Brak wymaganej zmiennej środowiskowej: ${envVar}`);
    process.exit(1);
  }
}

// Konfiguracja
const config = {
  ollamaUrl: process.env.OLLAMA_URL,
  wakeUrl: process.env.WAKE_COMPUTER_URL,
  wakeApiKey: process.env.WAKE_API_KEY,
  wakeDelay: parseInt(process.env.WAKE_DELAY) || 10
};

console.log('Konfiguracja serwera proxy:');
console.log(`- Ollama URL: ${config.ollamaUrl}`);
console.log(`- Wake URL: ${config.wakeUrl}`);
console.log(`- Port: ${PORT}`);
console.log(`- Wake delay: ${config.wakeDelay}s`);

// Inicjalizacja health checkera
const ollamaHealthChecker = new OllamaHealthChecker(
  config.ollamaUrl,
  config.wakeUrl,
  config.wakeApiKey,
  config.wakeDelay
);

// Middleware do logowania requestów i body
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware do parsowania JSON tylko dla naszych endpoints, nie dla proxy
app.use('/health', express.json({ limit: '50mb' }));
app.use('/ollama-status', express.json({ limit: '50mb' }));
app.use('/ollama-diagnostics', express.json({ limit: '50mb' }));
app.use('/test-ollama-call', express.json({ limit: '50mb' }));

// Endpoint healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'AI Proxy Server'
  });
});

// Endpoint do sprawdzenia statusu Ollama
app.get('/ollama-status', async (req, res) => {
  try {
    const startTime = Date.now();
    const isHealthy = await ollamaHealthChecker.checkOllamaHealth();
    const duration = Date.now() - startTime;
    
    res.json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      ollamaUrl: config.ollamaUrl,
      timestamp: new Date().toISOString(),
      responseTime: `${duration}ms`
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// Endpoint do szczegółowej diagnostyki połączenia
app.get('/ollama-diagnostics', async (req, res) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    config: {
      ollamaUrl: config.ollamaUrl,
      wakeUrl: config.wakeUrl,
      wakeDelay: config.wakeDelay
    },
    tests: {}
  };

  // Test 1: Podstawowy health check
  console.log('🔍 Uruchamianie diagnostyki Ollama...');
  try {
    const startTime = Date.now();
    const isHealthy = await ollamaHealthChecker.checkOllamaHealth();
    const duration = Date.now() - startTime;
    diagnostics.tests.healthCheck = {
      status: isHealthy ? 'PASS' : 'FAIL',
      duration: `${duration}ms`
    };
  } catch (error) {
    diagnostics.tests.healthCheck = {
      status: 'ERROR',
      error: error.message,
      code: error.code
    };
  }

  // Test 2: Raw HTTP request
  try {
    const axios = require('axios');
    const startTime = Date.now();
    const response = await axios.get(`${config.ollamaUrl}/api/tags`, {
      timeout: 15000,
      headers: {
        'User-Agent': 'AI-Proxy-Diagnostics/1.0'
      },
      validateStatus: () => true // Accept any status
    });
    const duration = Date.now() - startTime;
    
    diagnostics.tests.rawHttp = {
      status: response.status === 200 ? 'PASS' : 'FAIL',
      statusCode: response.status,
      duration: `${duration}ms`,
      headers: response.headers
    };
  } catch (error) {
    diagnostics.tests.rawHttp = {
      status: 'ERROR',
      error: error.message,
      code: error.code,
      stack: error.stack
    };
  }

  // Test 3: DNS resolution
  try {
    const dns = require('dns').promises;
    const url = require('url');
    const parsedUrl = new url.URL(config.ollamaUrl);
    const startTime = Date.now();
    const addresses = await dns.resolve4(parsedUrl.hostname);
    const duration = Date.now() - startTime;
    
    diagnostics.tests.dnsResolution = {
      status: 'PASS',
      hostname: parsedUrl.hostname,
      addresses,
      duration: `${duration}ms`
    };
  } catch (error) {
    diagnostics.tests.dnsResolution = {
      status: 'ERROR',
      error: error.message,
      code: error.code
    };
  }

  res.json(diagnostics);
});

// Endpoint do testowania konkretnego API call
app.post('/test-ollama-call', async (req, res) => {
  const testPayload = req.body || {
    model: "llama2",
    prompt: "Hello, this is a test",
    stream: false
  };

  console.log('🧪 Testowanie bezpośredniego wywołania Ollama...');
  console.log('Payload:', JSON.stringify(testPayload, null, 2));

  try {
    const axios = require('axios');
    const startTime = Date.now();
    
    const response = await axios.post(`${config.ollamaUrl}/api/generate`, testPayload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
        'User-Agent': 'AI-Proxy-Test/1.0'
      },
      validateStatus: () => true
    });
    
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      statusCode: response.status,
      headers: response.headers,
      dataPreview: typeof response.data === 'string' ? 
        response.data.substring(0, 500) + (response.data.length > 500 ? '...' : '') :
        response.data
    });
    
  } catch (error) {
    console.error('Test call failed:', error.message);
    res.status(500).json({
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
      code: error.code,
      status: error.response?.status,
      responseData: error.response?.data
    });
  }
});

// Konfiguracja proxy middleware
const proxyOptions = {
  target: config.ollamaUrl,
  changeOrigin: true,
  timeout: 300000, // 5 minut timeout
  proxyTimeout: 300000,
  logLevel: 'debug',
  secure: true, // Włącz weryfikację SSL
  ws: true, // Włącz WebSocket proxy dla streamingu
  followRedirects: true,
  // Konfiguracja dla lepszej stabilności połączeń
  xfwd: false, // Wyłącz X-Forwarded-* headers
  preserveHeaderKeyCase: true,
  // Konfiguracja dla HTTP/2 i streamingu
  agent: false, // Wyłącz pooling agentów - pozwól na nowe połączenia
  onError: (err, req, res) => {
    console.error('=== BŁĄD PROXY ===');
    console.error(`Czas: ${new Date().toISOString()}`);
    console.error(`Request: ${req.method} ${req.url}`);
    console.error(`Błąd: ${err.message}`);
    console.error(`Kod błędu: ${err.code}`);
    console.error(`Stack trace: ${err.stack}`);
    console.error('==================');
    
    // Sprawdź czy to błąd połączenia
    if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.log('Wykryto błąd połączenia z Ollama');
      console.log('Możliwe przyczyny:');
      console.log('- Serwer Ollama został zrestartowany');
      console.log('- Problem z siecią');
      console.log('- Timeout połączenia');
      console.log('- Problem z SSL/TLS');
      
      // Sprawdź natychmiast status Ollama
      ollamaHealthChecker.checkOllamaHealth().then(isHealthy => {
        console.log(`Status Ollama po błędzie: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
      });
      
      // Zwróć odpowiedź w formacie Ollama informującą o problemie
      const isGenerateEndpoint = req.path.includes('/generate');
      const isChatEndpoint = req.path.includes('/chat');
      
      if (isChatEndpoint) {
        res.json({
          model: req.body?.model || "unknown",
          created_at: new Date().toISOString(),
          message: {
            role: "assistant",
            content: `Wystąpił problem z połączeniem do serwera Ollama (${err.code}). Spróbuj ponownie za chwilę - serwer może się restartować.`
          },
          done: true,
          total_duration: 1000000,
          load_duration: 1000000,
          prompt_eval_count: 0,
          prompt_eval_duration: 0,
          eval_count: 1,
          eval_duration: 1000000
        });
      } else if (isGenerateEndpoint) {
        res.json({
          model: req.body?.model || "unknown",
          created_at: new Date().toISOString(),
          response: `Wystąpił problem z połączeniem do serwera Ollama (${err.code}). Spróbuj ponownie za chwilę - serwer może się restartować.`,
          done: true,
          context: [],
          total_duration: 1000000,
          load_duration: 1000000,
          prompt_eval_count: 0,
          prompt_eval_duration: 0,
          eval_count: 1,
          eval_duration: 1000000
        });
      } else {
        res.status(502).json({
          error: 'Bad Gateway',
          message: `Błąd komunikacji z Ollama - ${err.code}`,
          details: err.message,
          code: err.code,
          target: config.ollamaUrl,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Błąd komunikacji z Ollama',
        details: err.message,
        code: err.code,
        target: config.ollamaUrl,
        timestamp: new Date().toISOString()
      });
    }
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`=== PROXY REQUEST ===`);
    console.log(`Czas: ${new Date().toISOString()}`);
    console.log(`Request: ${req.method} ${req.url}`);
    console.log(`Target: ${config.ollamaUrl}${req.url}`);
    console.log(`Content-Type: ${req.headers['content-type']}`);
    console.log(`Content-Length: ${req.headers['content-length']}`);
    console.log(`User-Agent: ${req.headers['user-agent']}`);
    
    // Ustaw bezpieczne nagłówki (nie manipuluj body!)
    proxyReq.setHeader('Host', 'ollama.lukasik.ovh');
    proxyReq.setHeader('User-Agent', 'AI-Proxy/1.0');
    proxyReq.setHeader('Accept', 'application/json');
    
    // Obsługa streamingu
    if (req.url.includes('/generate') || req.url.includes('/chat')) {
      console.log('🔄 Streaming endpoint - używamy keep-alive');
      proxyReq.setHeader('Connection', 'keep-alive');
      proxyReq.setHeader('Cache-Control', 'no-cache');
    } else {
      proxyReq.setHeader('Connection', 'close');
    }
    
    console.log(`Headers set: Host=ollama.lukasik.ovh, User-Agent=AI-Proxy/1.0, Accept=application/json`);
    console.log('=====================');
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`=== PROXY RESPONSE ===`);
    console.log(`Czas: ${new Date().toISOString()}`);
    console.log(`Status: ${proxyRes.statusCode} dla ${req.method} ${req.url}`);
    console.log(`Content-Type: ${proxyRes.headers['content-type'] || 'brak'}`);
    console.log(`Content-Length: ${proxyRes.headers['content-length'] || 'brak'}`);
    console.log('======================');
    
    // Dodaj nagłówki CORS jeśli potrzebne
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    proxyRes.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
    proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-API-Key';
    
    // Dodaj nagłówki cache kontroli
    if (req.url.includes('/api/tags') || req.url.includes('/api/show')) {
      proxyRes.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
  }
};

// Główne proxy do Ollama z middleware
// Wszystkie endpointy API - standardowy middleware (czeka na uruchomienie)
app.use('/api', 
  ollamaHealthChecker.middleware(),
  createProxyMiddleware(proxyOptions)
);

// Proxy dla wszystkich innych ścieżek Ollama
app.use('/', 
  ollamaHealthChecker.middleware(),
  createProxyMiddleware(proxyOptions)
);

// Obsługa błędów
app.use((error, req, res, next) => {
  console.error('Nieobsłużony błąd:', error);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'Wystąpił nieoczekiwany błąd serwera'
  });
});

// Obsługa nieznanych ścieżek
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Nieznana ścieżka API'
  });
});

// Start serwera
app.listen(PORT, () => {
  console.log(`🚀 AI Proxy Server uruchomiony na porcie ${PORT}`);
  console.log(`📡 Proxy przekierowuje ruch do: ${config.ollamaUrl}`);
  console.log(`💻 Endpoint uruchamiania komputera: ${config.wakeUrl}`);
  console.log(`⚡ Czas oczekiwania po uruchomieniu: ${config.wakeDelay}s`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Otrzymano SIGTERM, zamykanie serwera...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Otrzymano SIGINT, zamykanie serwera...');
  process.exit(0);
});