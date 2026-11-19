import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // On cPanel, Passenger decides the real socket; PORT is only used locally.
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
