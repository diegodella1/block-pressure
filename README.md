# BLOCK PRESSURE — Bitcoin Mempool Live Visualization

**RoxomTV** — Broadcast-only Bitcoin mempool visualization. Pantalla completa, zero interacción del usuario. Estética de terminal financiero profesional estilo TradingView.

## Uso

1. Abrir `index.html` en un navegador moderno (Chrome, Firefox, Edge).
2. Para desarrollo local con servidor HTTP:
   ```bash
   npx serve .
   # o
   python -m http.server 8080
   ```
3. Navegar a `http://localhost:3000` (o el puerto que use serve).

## Modo Mock (testing)

Para probar sin conexión a la red Bitcoin, editar `app.js` y cambiar:

```javascript
USE_MOCK_DATA: true,
```

Esto genera un flujo sintético de transacciones (3–8 txs/seg) y un evento de bloque cada 10 minutos.

## Resolución

Optimizado para **1920×1080** y **3840×2160** (4K).

## Fuente de datos

- **WebSocket:** `wss://mempool.space/api/v1/ws`
- **Suscripciones:** `live-2h-chart`, `stats`, `mempool-blocks`, `blocks`

## Estructura

```
/
├── index.html    # Layout, estilos, estructura DOM
├── app.js        # Lógica completa (WebSocket, charts, order book, ticker, HUDs, eventos)
└── README.md
```

## Checklist PRD

- [x] Conecta al WebSocket de mempool.space
- [x] Area chart scrolling continuo
- [x] Tres capas apiladas (confirmado / fee bajo / fee alto)
- [x] Línea cyan de fee mínimo
- [x] Spikes de whale txs
- [x] Order book en tiempo real con flash en filas
- [x] Línea de corte dinámica
- [x] Barra de capacidad del próximo bloque
- [x] Ticker tape continuo
- [x] Velocidad del ticker según fee rate
- [x] Whale txs resaltadas
- [x] HUD superior e inferior
- [x] Eventos: bloque minado, whale
- [x] Indicador de conexión y reconexión automática
- [x] Mock data mode

---

*RoxomTV — Bitcoin Media & Broadcast Network*
