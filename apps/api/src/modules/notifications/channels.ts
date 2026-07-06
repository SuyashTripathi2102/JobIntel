import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One interface, many transports — Telegram now; email/Discord/push later. */
export interface NotificationChannel {
  readonly name: string;
  isConfigured(): boolean;
  send(text: string): Promise<void>;
}

/**
 * Telegram Bot API channel. Activates the moment TELEGRAM_BOT_TOKEN +
 * TELEGRAM_CHAT_ID appear in .env — no code change, no restart logic needed
 * beyond process restart. Get a token from @BotFather; get your chat id by
 * messaging the bot once and calling getUpdates.
 */
@Injectable()
export class TelegramChannel implements NotificationChannel {
  readonly name = 'telegram';
  private readonly logger = new Logger(TelegramChannel.name);
  private readonly token?: string;
  private readonly chatId?: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
    this.chatId = config.get<string>('TELEGRAM_CHAT_ID') || undefined;
  }

  isConfigured(): boolean {
    return !!this.token && !!this.chatId;
  }

  async send(text: string): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram sendMessage -> ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}
