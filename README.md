# AI Proxy Server

Serwer proxy do Ollama z automatycznym uruchamianiem komputera w przypadku niedostępności usługi.

## Funkcjonalności

- ✅ Transparentny proxy do serwera Ollama
- ✅ Automatyczne sprawdzanie dostępności Ollama
- ✅ Uruchamianie komputera przez API w przypadku niedostępności
- ✅ Logowanie requestów i błędów
- ✅ Graceful shutdown
- ✅ Endpoint healthcheck

## Instalacja

```bash
# Sklonuj repozytorium
git clone <repo-url>
cd ai-proxy

# Zainstaluj zależności
npm install

# Skopiuj i skonfiguruj plik środowiskowy
cp .env.example .env
```

## Konfiguracja

Edytuj plik `.env` i ustaw odpowiednie wartości:

```bash
# URL do serwera Ollama
OLLAMA_URL=http://192.168.1.100:11434

# URL do endpointu uruchamiania komputera
WAKE_COMPUTER_URL=http://192.168.1.1:8080/wake

# API key do autoryzacji uruchamiania komputera
WAKE_API_KEY=your-wake-api-key-here

# Port na którym działa proxy (opcjonalne, domyślnie 3000)
PORT=3000

# Czas oczekiwania po uruchomieniu komputera w sekundach (opcjonalne, domyślnie 10)
WAKE_DELAY=10
```

## Uruchomienie

### Tryb produkcyjny
```bash
npm start
```

### Tryb rozwojowy (z automatycznym restartem)
```bash
npm run dev
```

## Użycie

Wszystkie requesty są teraz przekierowywane bez autoryzacji:

```bash
curl http://localhost:3000/api/tags
```

### Dostępne endpointy

#### Health Check
```bash
GET /health
```
Sprawdza status serwera proxy (nie wymaga autoryzacji).

#### Status Ollama
```bash
GET /ollama-status
```
Sprawdza dostępność serwera Ollama.

#### Proxy do Ollama
Wszystkie pozostałe requesty są transparentnie przekierowywane do Ollama:

```bash
# Lista modeli
GET /api/tags

# Generowanie tekstu
POST /api/generate

# Chat
POST /api/chat

# Wszystkie inne endpointy Ollama...
```

## Jak to działa

1. **Request przychodzi** - serwer przyjmuje request bez autoryzacji
2. **Middleware Ollama** - sprawdza czy Ollama jest dostępna
3. **Jeśli Ollama nie działa**:
   - Wysyła request do endpointu uruchamiania komputera
   - Czeka określony czas (domyślnie 10 sekund)
   - Sprawdza ponownie dostępność Ollama
4. **Jeśli Ollama działa** - przekierowuje request transparentnie

## Przykład użycia

```javascript
const response = await fetch('http://localhost:3000/api/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'llama2',
    prompt: 'Hello, world!',
    stream: false
  })
});

const data = await response.json();
console.log(data);
```

## Wymagania

- Node.js (wersja 16 lub wyższa)
- Dostęp do serwera Ollama
- API endpoint do uruchamiania komputera (np. Wake-on-LAN API)

## API uruchamiania komputera

Serwer oczekuje, że endpoint uruchamiania komputera:
- Przyjmuje POST request
- Wymaga autoryzacji przez nagłówek `X-API-Key`
- Zwraca status 200 w przypadku sukcesu

Przykład implementacji endpointu Wake-on-LAN można znaleźć w folderze `examples/`.

## Błędy i debugowanie

Serwer loguje wszystkie ważne wydarzenia:
- Incoming requests
- Ollama health checks
- Computer wake attempts
- Proxy forwards
- Errors

W przypadku problemów sprawdź logi serwera.

## Licencja

ISC