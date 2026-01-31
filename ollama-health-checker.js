const axios = require('axios');

class OllamaHealthChecker {
  constructor(ollamaUrl, wakeUrl, wakeApiKey, wakeDelay = 10) {
    this.ollamaUrl = ollamaUrl;
    this.wakeUrl = wakeUrl;
    this.wakeApiKey = wakeApiKey;
    this.wakeDelay = wakeDelay * 1000; // Convert to milliseconds
    this.isWaking = false;
  }

  /**
   * Sprawdza czy Ollama jest dostępna
   */
  async checkOllamaHealth() {
    try {
      console.log(`Sprawdzanie health Ollama: ${this.ollamaUrl}/api/tags`);
      
      const response = await axios.get(`${this.ollamaUrl}/api/tags`, {
        timeout: 10000, // Zwiększony timeout
        headers: {
          'Connection': 'close', // Zmienione z keep-alive
          'User-Agent': 'AI-Proxy-Health-Check/1.0',
          'Accept': 'application/json'
        },
        // Dodatkowe opcje dla stabilności
        maxRedirects: 3,
        validateStatus: function (status) {
          return status === 200; // Tylko 200 jest OK
        },
        // Jeśli to HTTPS, dodaj opcje SSL
        httpsAgent: this.ollamaUrl.startsWith('https://') ? 
          new (require('https')).Agent({ 
            rejectUnauthorized: false, // Dla self-signed certificates
            keepAlive: false
          }) : undefined
      });
      
      console.log(`Health check sukces: ${response.status}`);
      return response.status === 200;
    } catch (error) {
      console.error(`=== HEALTH CHECK FAILED ===`);
      console.error(`Czas: ${new Date().toISOString()}`);
      console.error(`URL: ${this.ollamaUrl}/api/tags`);
      console.error(`Błąd: ${error.message}`);
      console.error(`Kod: ${error.code || 'unknown'}`);
      console.error(`Status: ${error.response?.status || 'brak'}`);
      if (error.response?.data) {
        console.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      console.error('===========================');
      
      // Sprawdź specyficzne błędy
      if (error.code === 'ECONNRESET') {
        console.log('🔄 ECONNRESET - połączenie zostało przerwane przez serwer');
        console.log('   Możliwe przyczyny:');
        console.log('   - Serwer Ollama restartuje się');
        console.log('   - Problem z siecią');
        console.log('   - Timeout połączenia');
        console.log('   - Problem z reverse proxy');
      } else if (error.code === 'ECONNREFUSED') {
        console.log('🚫 ECONNREFUSED - serwer Ollama nie odpowiada');
      } else if (error.code === 'ETIMEDOUT') {
        console.log('⏰ ETIMEDOUT - timeout połączenia');
      } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        console.log('🔒 Problem z certyfikatem SSL/TLS');
      }
      
      return false;
    }
  }

  /**
   * Uruchamia komputer przez API
   */
  async wakeComputer() {
    try {
      console.log('Uruchamianie komputera...');
      const response = await axios.post(this.wakeUrl, {}, {
        headers: {
          'X-API-Key': this.wakeApiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      if (response.status === 200) {
        console.log('Komputer został uruchomiony, oczekiwanie...');
        return true;
      } else {
        console.error('Błąd uruchamiania komputera:', response.status);
        return false;
      }
    } catch (error) {
      console.error('Błąd podczas uruchamiania komputera:', error.message);
      return false;
    }
  }

  /**
   * Oczekuje przez określony czas
   */
  async delay() {
    return new Promise(resolve => setTimeout(resolve, this.wakeDelay));
  }

  /**
   * Główny middleware - sprawdza Ollama, uruchamia komputer jeśli potrzeba
   */
  async ensureOllamaReady() {
    // Jeśli już w trakcie uruchamiania, czekaj
    if (this.isWaking) {
      console.log('Komputer jest już w trakcie uruchamiania, oczekiwanie...');
      while (this.isWaking) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Sprawdź czy Ollama działa
    const isHealthy = await this.checkOllamaHealth();
    
    if (isHealthy) {
      console.log('Ollama jest dostępna');
      return true;
    }

    // Ollama nie działa, uruchom komputer
    console.log('Ollama nie jest dostępna, próba uruchomienia komputera...');
    this.isWaking = true;

    try {
      const wakeResult = await this.wakeComputer();
      
      if (!wakeResult) {
        this.isWaking = false;
        throw new Error('Nie udało się uruchomić komputera');
      }

      // Oczekaj określony czas
      await this.delay();

      // Sprawdź ponownie czy Ollama działa
      const isHealthyAfterWake = await this.checkOllamaHealth();
      this.isWaking = false;

      if (isHealthyAfterWake) {
        console.log('Ollama jest teraz dostępna po uruchomieniu komputera');
        return true;
      } else {
        throw new Error('Ollama nadal nie jest dostępna po uruchomieniu komputera');
      }
    } catch (error) {
      this.isWaking = false;
      throw error;
    }
  }

  /**
   * Express middleware dla endpointów czatowych - zwraca przyjazny komunikat podczas uruchamiania
   */
  chatMiddleware() {
    return async (req, res, next) => {
      try {
        // Sprawdź czy Ollama działa
        const isHealthy = await this.checkOllamaHealth();
        
        if (isHealthy) {
          console.log('Ollama jest dostępna');
          next();
          return;
        }

        // Ollama nie działa - uruchom komputer w tle i zwróć komunikat
        console.log('Ollama nie jest dostępna, uruchamianie komputera w tle...');
        
        // Uruchom komputer asynchronicznie (nie czekamy)
        this.wakeComputer().catch(error => {
          console.error('Błąd podczas uruchamiania komputera:', error.message);
        });

        // Sprawdź czy request oczekuje streamingu
        const requestBody = req.body;
        const isStreaming = requestBody && requestBody.stream === true;

        if (isStreaming) {
          // Dla streamingu - wyślij w formacie Ollama
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          // Sprawdź typ endpointu na podstawie URL
          const isGenerateEndpoint = req.path.includes('/generate');
          const isChatEndpoint = req.path.includes('/chat');

          if (isGenerateEndpoint) {
            // Format dla /api/generate
            const streamMessage = {
              model: requestBody.model || "unknown",
              created_at: new Date().toISOString(),
              response: "Cześć! 👋 Trwa uruchomienie serwera z Ollama. Wyślij ponowne zapytanie za około 20 sekund.",
              done: true
            };
            res.write(JSON.stringify(streamMessage) + '\n');
          } else if (isChatEndpoint) {
            // Format dla /api/chat
            const streamMessage = {
              model: requestBody.model || "unknown",
              created_at: new Date().toISOString(),
              message: {
                role: "assistant",
                content: "Cześć! 👋 Trwa uruchomienie serwera z Ollama. Wyślij ponowne zapytanie za około 20 sekund."
              },
              done: true
            };
            res.write(JSON.stringify(streamMessage) + '\n');
          }

          res.end();
        } else {
          // Dla zwykłego JSON - zwróć w formacie Ollama
          const isGenerateEndpoint = req.path.includes('/generate');
          const isChatEndpoint = req.path.includes('/chat');

          if (isGenerateEndpoint) {
            // Format dla /api/generate bez streamingu
            res.json({
              model: requestBody.model || "unknown",
              created_at: new Date().toISOString(),
              response: "Cześć! 👋 Trwa uruchomienie serwera z Ollama. Wyślij ponowne zapytanie za około 20 sekund.",
              done: true,
              context: [],
              total_duration: 1000000,
              load_duration: 1000000,
              prompt_eval_count: 0,
              prompt_eval_duration: 0,
              eval_count: 1,
              eval_duration: 1000000
            });
          } else if (isChatEndpoint) {
            // Format dla /api/chat bez streamingu
            res.json({
              model: requestBody.model || "unknown",
              created_at: new Date().toISOString(),
              message: {
                role: "assistant",
                content: "Cześć! 👋 Trwa uruchomienie serwera z Ollama. Wyślij ponowne zapytanie za około 20 sekund."
              },
              done: true,
              total_duration: 1000000,
              load_duration: 1000000,
              prompt_eval_count: 0,
              prompt_eval_duration: 0,
              eval_count: 1,
              eval_duration: 1000000
            });
          } else {
            // Dla innych endpointów - komunikat ogólny
            res.status(503).json({
              message: "Cześć! 👋 Trwa uruchomienie serwera z Ollama.",
              instruction: "Wyślij ponowne zapytanie za około 20 sekund.",
              status: "waking_up",
              estimated_wait: "20 sekund",
              timestamp: new Date().toISOString()
            });
          }
        }

      } catch (error) {
        console.error('Błąd chat middleware:', error.message);
        res.status(503).json({
          message: "Cześć! 👋 Wystąpił problem z uruchomieniem komputera.",
          instruction: "Spróbuj ponownie za chwilę.",
          error: error.message,
          status: "error",
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Express middleware
   */
  middleware() {
    return async (req, res, next) => {
      try {
        await this.ensureOllamaReady();
        next();
      } catch (error) {
        console.error('Błąd middleware Ollama:', error.message);
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'Nie można nawiązać połączenia z Ollama',
          details: error.message
        });
      }
    };
  }
}

module.exports = OllamaHealthChecker;