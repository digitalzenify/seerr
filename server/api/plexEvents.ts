/**
 * PlexEventsClient
 *
 * Opens a persistent connection to the Plex notification stream.
 * Prefers the SSE endpoint (/:/eventsource) and falls back to the
 * WebSocket endpoint (/:/websockets/notifications) when SSE is unavailable.
 *
 * Emits typed events to subscribers and handles reconnection with
 * exponential backoff. Exposes a `status` property for health checks.
 */

import type { PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';
import WebSocket from 'ws';

export type PlexEventStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface PlexNotificationEvent {
  type: string;
  /** Raw notification payload from Plex */
  payload: Record<string, unknown>;
}

type PlexEventsListener = (event: PlexNotificationEvent) => void;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_JITTER_MS = 500;

function buildBaseUrl(plexSettings: PlexSettings): string {
  const protocol = plexSettings.useSsl ? 'https' : 'http';
  return `${protocol}://${plexSettings.ip}:${plexSettings.port}`;
}

class PlexEventsClient extends EventEmitter {
  private _status: PlexEventStatus = 'disconnected';
  private token: string;
  private baseUrl: string;
  private wsBaseUrl: string;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentConnection: WebSocket | null = null;
  private sseRequest: http.ClientRequest | null = null;
  private destroyed = false;
  private clientId: string;

  constructor(token?: string, plexSettings?: PlexSettings) {
    super();
    const settings = getSettings();
    const resolved = plexSettings ?? settings.plex;
    this.token = token ?? resolved.authToken ?? '';
    this.clientId = settings.clientId;
    this.baseUrl = buildBaseUrl(resolved);
    this.wsBaseUrl = this.baseUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
  }

  get status(): PlexEventStatus {
    return this._status;
  }

  /** Start listening. Safe to call multiple times. */
  public connect(): void {
    if (this.destroyed) return;
    if (
      this._status === 'connecting' ||
      this._status === 'connected'
    )
      return;
    this._status = 'connecting';
    this.trySSE();
  }

  /** Stop all connections and prevent reconnection. */
  public destroy(): void {
    this.destroyed = true;
    this._status = 'disconnected';
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeCurrent();
  }

  private closeCurrent(): void {
    if (this.sseRequest) {
      this.sseRequest.destroy();
      this.sseRequest = null;
    }
    if (this.currentConnection) {
      this.currentConnection.terminate();
      this.currentConnection = null;
    }
  }

  private scheduleReconnect(useWebSocket: boolean): void {
    if (this.destroyed) return;
    this._status = 'disconnected';
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt +
        Math.random() * RECONNECT_JITTER_MS,
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt += 1;
    logger.debug(
      `PlexEventsClient: reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`,
      { label: 'Plex Events' }
    );
    this.reconnectTimer = setTimeout(() => {
      if (useWebSocket) {
        this.tryWebSocket();
      } else {
        this.trySSE();
      }
    }, delay);
  }

  /** Try SSE connection (/:/eventsource) */
  private trySSE(): void {
    if (this.destroyed) return;
    const url = new URL(`${this.baseUrl}/:/eventsource`);
    url.searchParams.set('X-Plex-Token', this.token);
    url.searchParams.set('X-Plex-Client-Identifier', this.clientId);

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    logger.debug('PlexEventsClient: attempting SSE connection', {
      label: 'Plex Events',
      url: url.origin + url.pathname,
    });

    const req = lib.get(
      url.toString(),
      {
        headers: {
          Accept: 'text/event-stream',
          'X-Plex-Token': this.token,
          'X-Plex-Client-Identifier': this.clientId,
        },
      },
      (res) => {
        if (res.statusCode === 200 && res.headers['content-type']?.includes('text/event-stream')) {
          this.onSSEConnected(res, req);
        } else {
          logger.debug(
            `PlexEventsClient: SSE not supported (${res.statusCode}), falling back to WebSocket`,
            { label: 'Plex Events' }
          );
          req.destroy();
          this.tryWebSocket();
        }
      }
    );

    req.on('error', (err) => {
      logger.debug(`PlexEventsClient: SSE connection error: ${err.message}`, {
        label: 'Plex Events',
      });
      this.scheduleReconnect(false);
    });

    req.setTimeout(15_000, () => {
      req.destroy();
      logger.debug('PlexEventsClient: SSE connection timed out, falling back to WebSocket', {
        label: 'Plex Events',
      });
      this.tryWebSocket();
    });

    this.sseRequest = req;
  }

  private onSSEConnected(
    res: http.IncomingMessage,
    req: http.ClientRequest
  ): void {
    this._status = 'connected';
    this.reconnectAttempt = 0;
    this.emit('connected');
    logger.debug('PlexEventsClient: SSE connection established', {
      label: 'Plex Events',
    });

    let buffer = '';
    res.setEncoding('utf-8');

    res.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let eventType = 'message';
      let data = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data = line.slice(5).trim();
        } else if (line === '') {
          if (data) {
            try {
              const payload = JSON.parse(data) as Record<string, unknown>;
              const event: PlexNotificationEvent = { type: eventType, payload };
              this.emit('event', event);
            } catch {
              // ignore malformed JSON
            }
            data = '';
            eventType = 'message';
          }
        }
      }
    });

    res.on('end', () => {
      logger.debug('PlexEventsClient: SSE connection ended', {
        label: 'Plex Events',
      });
      this.sseRequest = null;
      this.scheduleReconnect(false);
    });

    res.on('error', (err) => {
      logger.debug(`PlexEventsClient: SSE stream error: ${err.message}`, {
        label: 'Plex Events',
      });
      req.destroy();
      this.sseRequest = null;
      this.scheduleReconnect(false);
    });
  }

  /** Try WebSocket connection (/:/websockets/notifications) */
  private tryWebSocket(): void {
    if (this.destroyed) return;
    const wsUrl = `${this.wsBaseUrl}/:/websockets/notifications?X-Plex-Token=${encodeURIComponent(this.token)}&X-Plex-Client-Identifier=${encodeURIComponent(this.clientId)}`;

    logger.debug('PlexEventsClient: attempting WebSocket connection', {
      label: 'Plex Events',
    });

    const ws = new WebSocket(wsUrl, {
      handshakeTimeout: 15_000,
      headers: {
        'X-Plex-Token': this.token,
        'X-Plex-Client-Identifier': this.clientId,
      },
    });

    this.currentConnection = ws;

    ws.on('open', () => {
      this._status = 'connected';
      this.reconnectAttempt = 0;
      this.emit('connected');
      logger.debug('PlexEventsClient: WebSocket connection established', {
        label: 'Plex Events',
      });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          NotificationContainer?: {
            type?: string;
            [key: string]: unknown;
          };
        };
        const container = msg.NotificationContainer ?? {};
        const event: PlexNotificationEvent = {
          type: String(container.type ?? 'unknown'),
          payload: container,
        };
        this.emit('event', event);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      logger.debug('PlexEventsClient: WebSocket connection closed', {
        label: 'Plex Events',
      });
      this.currentConnection = null;
      this.scheduleReconnect(true);
    });

    ws.on('error', (err) => {
      logger.debug(`PlexEventsClient: WebSocket error: ${err.message}`, {
        label: 'Plex Events',
      });
      this._status = 'error';
      this.emit('error', err);
      ws.terminate();
      this.currentConnection = null;
      this.scheduleReconnect(true);
    });
  }

  /** Subscribe to Plex notification events */
  public onEvent(listener: PlexEventsListener): this {
    return this.on('event', listener);
  }

  /** Remove an event listener */
  public offEvent(listener: PlexEventsListener): this {
    return this.off('event', listener);
  }
}

export default PlexEventsClient;