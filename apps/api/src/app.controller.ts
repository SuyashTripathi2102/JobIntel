import { Controller, Get } from '@nestjs/common';
import { WorkModeSchema } from '@jobintel/shared';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  getHealth(): { status: string; supportedWorkModes: string[] } {
    return { status: 'ok', supportedWorkModes: WorkModeSchema.options };
  }
}
