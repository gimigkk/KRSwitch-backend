# WebSockets & Real-Time

## 📡 WebSocket Event API

WebSockets run over **Socket.IO** with mandatory token validations:

### 1. Connection Handshake
Clients must request a token from `GET /api/socket-token` and submit it inside the `authenticate` channel within 10 seconds of socket connection:
```js
socket.emit('authenticate', socketToken);
```

### 2. Socket Events Topology
The Socket.IO server establishes authentication boundaries and broadcasts state updates across channels:

*   **Auth Room Boundary**: Connections must complete token verification inside `10 seconds`. Stale socket keys force disconnections.
*   **System Channels**:
    *   `online-count` *(integer)*: Returns total active user connections.
    *   `new-offer` *(object)*: Triggered when an offer is posted to append listings to feed pages.
    *   `offer-taken` *(object)*: Broadcasted when an offer is swapped or cancelled to clean client listings.
    *   `enrollments-swapped` *(object)*: Broadcasts swapped schedules parameters upon successful trades.
