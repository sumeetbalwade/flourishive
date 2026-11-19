import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports ok with an ISO timestamp', () => {
    const result = new HealthController().check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('flourishive-api');
    expect(new Date(result.time).toISOString()).toBe(result.time);
  });
});
