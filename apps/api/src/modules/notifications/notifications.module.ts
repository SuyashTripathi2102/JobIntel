import { Module } from '@nestjs/common';
import { TelegramChannel } from './channels';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, TelegramChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}
