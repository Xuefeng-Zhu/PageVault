// lib/notifications/channels/webhook.ts
import { createHmac } from 'node:crypto';

export interface WebhookConfig {
  url: string;
  secret?: string;
}

export interface NotificationPayload {
  event: string;
  room: { id: string; name: string; storageFolderPath: string | null };
  change: {
    id: string;
    severity: string;
    changeType: string;
    summary: string;
    businessInterpretation: string | null;
    recommendedActions: string[];
    evidence: unknown[];
    confidence: number | null;
    url: string | null;
    capturedAt: string | null;
  };
  deliveredAt: string;
}

export class WebhookChannel {
  async send(payload: NotificationPayload, config: WebhookConfig): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'PageVault/1.0',
      'x-pagevault-event': payload.event,
    };
    if (config.secret) {
      const hmac = createHmac('sha256', config.secret).update(body).digest('hex');
      headers['x-pagevault-signature'] = `sha256=${hmac}`;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(config.url, {
        method: 'POST', headers, body, signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Webhook returned ${res.status}: ${text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const webhookChannel = new WebhookChannel();
