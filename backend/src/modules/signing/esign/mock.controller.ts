import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../identity/auth.context.js';
import { EsignGateway } from './gateway.js';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The pretend provider page. Only exists when ESIGN_PROVIDER=mock. */
@Public()
@Controller('public/esign/mock')
export class MockEsignController {
  constructor(private readonly gateway: EsignGateway) {}

  @Get(':id')
  async page(@Param('id') id: string, @Res() res: Response) {
    const mock = this.gateway.mock();
    const s = mock ? await mock.state(id) : null;
    if (!s) throw new NotFoundException();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Test Aadhaar eSign</title>
<body style="font:16px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1>Test Aadhaar eSign</h1>
<p><b>This is a pretend provider for testing.</b> No Aadhaar is used and nothing signed here is genuine.</p>
<p>${esc(s.signerName)} is signing <b>${esc(s.documentName)}</b>.</p>
<p><a href="/v1/public/esign/mock/${esc(id)}/approve" style="padding:.6rem 1rem;background:#222;color:#fff;border-radius:6px;text-decoration:none">Approve (test)</a>
&nbsp;<a href="/v1/public/esign/mock/${esc(id)}/decline">Decline</a></p>`);
  }

  @Get(':id/approve')
  async approve(@Param('id') id: string, @Res() res: Response) {
    return this.decide(id, true, res);
  }

  @Get(':id/decline')
  async decline(@Param('id') id: string, @Res() res: Response) {
    return this.decide(id, false, res);
  }

  private async decide(id: string, approved: boolean, res: Response) {
    const to = await this.gateway.mock()?.decide(id, approved);
    if (!to) throw new NotFoundException();
    res.redirect(302, to);
  }
}
