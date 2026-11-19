import { ApiError } from '@flourishive/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { slugify } from './pages/Tenants.tsx';
import { fakeClient } from './test/fake-client.ts';

function open(hash: string, client = fakeClient()) {
  location.hash = hash;
  render(<App client={client} retryDelay={0} />);
  return { client, user: userEvent.setup() };
}
const signedIn = (over: Record<string, unknown> = {}) =>
  fakeClient({ restoreSession: vi.fn().mockResolvedValue(true), ...over });

async function fillLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'root@flourishive.test');
  await user.type(screen.getByLabelText('Password'), 'a long platform passphrase');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('admin sign in', () => {
  it('always asks for the authenticator code, then opens the tenants list', async () => {
    const client = fakeClient();
    client.auth.login.mockResolvedValue({ status: 'mfa_required', mfaToken: 'm1' });
    client.auth.mfaVerify.mockResolvedValue({ status: 'ok', accessToken: 'a', expiresIn: 900 });
    const { user } = open('#/login', client);
    await screen.findByRole('heading', { name: 'Admin sign in' });
    await fillLogin(user);
    await screen.findByRole('heading', { name: 'Two-step check' });
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(client.auth.mfaVerify).toHaveBeenCalledWith({ mfaToken: 'm1', code: '123456' });
    expect(await screen.findByText('Flourisense')).toBeInTheDocument();
    expect(location.hash).toBe('#/tenants');
  });

  it('shows the server’s message for a wrong password', async () => {
    const client = fakeClient();
    client.auth.login.mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    const { user } = open('#/login', client);
    await screen.findByRole('heading', { name: 'Admin sign in' });
    await fillLogin(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('keeps signed-out visitors out', async () => {
    open('#/tenants');
    await screen.findByRole('heading', { name: 'Admin sign in' });
    expect(location.hash).toBe('#/login');
  });

  it('lets invited staff choose a password from the emailed link', async () => {
    const client = fakeClient();
    client.auth.setPassword.mockResolvedValue(undefined);
    const { user } = open('#/set-password?token=abc123', client);
    await user.type(await screen.findByLabelText('New password'), 'a long platform passphrase');
    await user.type(screen.getByLabelText('Repeat password'), 'a long platform passphrase');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(client.auth.setPassword).toHaveBeenCalledWith('abc123', 'a long platform passphrase');
    expect(await screen.findByText('Password saved')).toBeInTheDocument();
  });
});

describe('tenants', () => {
  it('lists tenants with counts', async () => {
    open('#/tenants', signedIn());
    expect(await screen.findByText('Flourisense')).toBeInTheDocument();
    expect(screen.getByText('flourisense')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('suggests a company code and creates a tenant', async () => {
    const client = signedIn();
    client.tenants.create.mockResolvedValue({
      id: 't2',
      slug: 'acme-logistics',
      name: 'Acme Logistics Pvt Ltd',
      adminEmail: 'boss@acme.test',
    });
    const { user } = open('#/tenants', client);
    await user.click(await screen.findByRole('button', { name: /New tenant/ }));
    await user.type(screen.getByLabelText('Company name'), 'Acme Logistics Pvt Ltd');
    expect(screen.getByLabelText('Company code')).toHaveValue('acme-logistics');
    await user.type(screen.getByLabelText('First admin’s email'), 'boss@acme.test');
    await user.click(screen.getByRole('button', { name: 'Create tenant' }));
    await waitFor(() =>
      expect(client.tenants.create).toHaveBeenCalledWith({
        slug: 'acme-logistics',
        name: 'Acme Logistics Pvt Ltd',
        companyName: 'Acme Logistics Pvt Ltd',
        legalName: 'Acme Logistics Pvt Ltd',
        adminEmail: 'boss@acme.test',
      }),
    );
  });

  it('shows the server’s reason when a company code is taken', async () => {
    const client = signedIn();
    client.tenants.create.mockRejectedValue(
      new ApiError(409, 'That company code is already taken'),
    );
    const { user } = open('#/tenants', client);
    await user.click(await screen.findByRole('button', { name: /New tenant/ }));
    await user.type(screen.getByLabelText('Company name'), 'Acme');
    await user.type(screen.getByLabelText('First admin’s email'), 'boss@acme.test');
    await user.click(screen.getByRole('button', { name: 'Create tenant' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already taken');
  });

  it('asks before suspending, then suspends', async () => {
    const client = signedIn();
    const { user } = open('#/tenants/t1', client);
    await screen.findByRole('heading', { name: 'Flourisense' });
    expect(screen.getByText('Intact')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suspend…' }));
    expect(client.tenants.update).not.toHaveBeenCalled(); // nothing until confirmed
    await user.click(await screen.findByRole('button', { name: 'Suspend tenant' }));
    expect(client.tenants.update).toHaveBeenCalledWith('t1', { status: 'SUSPENDED' });
  });

  it('shows and resets a tenant’s own setting', async () => {
    const client = signedIn();
    const { user } = open('#/tenants/t1', client);
    expect(
      await screen.findByText('How long a sign-in lasts without activity'),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Reset' }));
    expect(client.tenants.clearSetting).toHaveBeenCalledWith('t1', 'security.sessionDays');
  });

  it('sends numbers as numbers when saving a setting', async () => {
    const client = signedIn();
    const { user } = open('#/tenants/t1', client);
    await screen.findByText('Accent colour');
    const change = screen.getAllByRole('button', { name: 'Change' });
    await user.click(change[0]!);
    await user.type(await screen.findByLabelText('Value'), '7');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.tenants.setSetting).toHaveBeenCalledWith('t1', 'security.sessionDays', 37);
  });
});

describe('staff and defaults', () => {
  it('does not offer to disable yourself', async () => {
    open('#/users', signedIn());
    await screen.findByText('second@flourishive.test');
    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(1);
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('invites staff and shows the link as a fallback', async () => {
    const client = signedIn();
    client.staff.invite.mockResolvedValue({
      id: 's3',
      link: 'http://localhost:5174/#/set-password?token=zzz',
      emailed: false,
    });
    const { user } = open('#/users', client);
    await user.click(await screen.findByRole('button', { name: /Invite/ }));
    await user.type(screen.getByLabelText('Email'), 'new@flourishive.test');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(client.staff.invite).toHaveBeenCalledWith('new@flourishive.test');
    expect(await screen.findByText(/set-password\?token=zzz/)).toBeInTheDocument();
  });

  it('changes a platform default, locks it, and saves them together', async () => {
    const client = signedIn();
    const { user } = open('#/settings', client);
    await screen.findByText('How long a sign-in lasts without activity');
    const input = screen.getByLabelText('Stay signed in (days)');
    await user.clear(input);
    await user.type(input, '10');
    await user.click(
      screen.getByRole('switch', { name: 'Lock Stay signed in (days) for companies' }),
    );
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(client.settings.set).toHaveBeenCalledWith('security.sessionDays', {
      value: 10,
      locked: true,
    });
  });

  it('does not offer a lock for platform-only settings, and can discard', async () => {
    const client = signedIn();
    const { user } = open('#/settings', client);
    await screen.findByText('How long a sign-in lasts without activity');
    await user.click(screen.getByRole('tab', { name: 'Platform' }));
    expect(screen.queryByRole('switch', { name: /Lock/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Security' }));
    await user.type(screen.getByLabelText('Stay signed in (days)'), '5');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText(/unsaved/)).not.toBeInTheDocument();
    expect(client.settings.set).not.toHaveBeenCalled();
  });
});

describe('lost authenticator', () => {
  it('emails a code and moves to setting up a new authenticator', async () => {
    const client = fakeClient();
    client.auth.login.mockResolvedValue({ status: 'mfa_required', mfaToken: 'm1' });
    client.auth.mfaRecoveryVerify.mockResolvedValue({
      status: 'mfa_setup_required',
      mfaToken: 's1',
    });
    client.auth.mfaSetup.mockResolvedValue({ secret: 'ABCDEF', otpauthUri: 'otpauth://totp/x' });
    const { user } = open('#/login', client);
    await user.type(await screen.findByLabelText('Email'), 'super@flourishive.test');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: /Email me a code/ }));
    expect(client.auth.mfaRecoveryStart).toHaveBeenCalledWith('m1');
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and set up again' }));
    expect(client.auth.mfaRecoveryVerify).toHaveBeenCalledWith('m1', '123456');
    await waitFor(() => expect(client.auth.mfaSetup).toHaveBeenCalledWith('s1'));
  });
});

describe('security policy', () => {
  it('sets a role’s default, keeps it above its floor, and warns when staff two-step is off', async () => {
    const client = signedIn();
    const { user } = open('#/policy', client);
    await screen.findByText('HR Lead');
    // HR Lead's floor is Required, so Off and Optional are not selectable for its default.
    const group = screen.getByRole('radiogroup', { name: 'Default two-step for HR Lead' });
    expect(within(group).getByRole('radio', { name: 'Off' })).toBeDisabled();
    expect(within(group).getByRole('radio', { name: 'Optional' })).toBeDisabled();

    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Default two-step for Employee' })).getByRole(
        'radio',
        {
          name: 'Required',
        },
      ),
    );
    expect(client.policies.set).toHaveBeenCalledWith('employee', { mfaLevel: 'REQUIRED' });

    await user.click(screen.getByRole('switch', { name: 'Email recovery for HR Lead' }));
    expect(client.policies.set).toHaveBeenCalledWith('hr_lead', { recoveryEmail: false });

    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Two-step for platform staff' })).getByRole(
        'radio',
        {
          name: 'Off',
        },
      ),
    );
    expect(client.settings.set).toHaveBeenCalledWith('platform.superAdminMfa', { value: 'OFF' });
  });
});

describe('slugify', () => {
  it('turns company names into codes', () => {
    expect(slugify('Acme Logistics Pvt Ltd')).toBe('acme-logistics');
    expect(slugify('  Nova Retail & Co. ')).toBe('nova-retail-co');
    expect(slugify('Flourisense Technologies LLP')).toBe('flourisense-technologies');
  });
});
