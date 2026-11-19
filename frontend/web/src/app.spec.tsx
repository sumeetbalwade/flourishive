import { ApiError } from '@flourishive/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { ASHA, ME, fakeClient } from './test/fake-client.ts';

function open(hash: string, client = fakeClient()) {
  location.hash = hash;
  render(<App client={client} retryDelay={0} />);
  return { client, user: userEvent.setup() };
}

async function fillLogin(user: ReturnType<typeof userEvent.setup>, password = 'a long password') {
  await user.clear(screen.getByLabelText('Company code'));
  await user.type(screen.getByLabelText('Company code'), 'Flourisense');
  await user.type(screen.getByLabelText('Work email'), 'hr@flourisense.test');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('app shell', () => {
  it('shows an employee a short menu and HR the full one', async () => {
    const employee = fakeClient({ isSignedIn: vi.fn().mockReturnValue(true) });
    employee.auth.me.mockResolvedValue({ ...ME, permissions: ['self.read'], mfaRequired: false });
    employee.restoreSession.mockResolvedValue(true);
    const first = render(<App client={employee} retryDelay={0} />);
    location.hash = '#/app/home';
    await screen.findByRole('heading', { name: /Welcome/ });
    expect(screen.queryByRole('button', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My security' })).toBeInTheDocument();
    first.unmount();

    const hr = fakeClient();
    hr.restoreSession.mockResolvedValue(true);
    open('#/app/home', hr);
    await screen.findByRole('heading', { name: /Welcome/ });
    for (const name of ['People', 'Import', 'Organisation', 'Audit log'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('collapses the sidebar and remembers it', async () => {
    const client = fakeClient();
    client.restoreSession.mockResolvedValue(true);
    const { user } = open('#/app/home', client);
    await screen.findByRole('heading', { name: /Welcome/ });
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('fh-sidebar')).toBe('collapsed');
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('fh-sidebar')).toBe('open');
  });

  it('finds a page from the search palette', async () => {
    const client = fakeClient();
    client.restoreSession.mockResolvedValue(true);
    const { user } = open('#/app/home', client);
    await screen.findByRole('heading', { name: /Welcome/ });
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByLabelText('Search', { selector: 'input' }), 'organ');
    await user.keyboard('{Enter}');
    expect(location.hash).toBe('#/app/org');
  });
});

describe('find your company', () => {
  it('emails the sign-in link and says the same whatever the answer', async () => {
    const { client, user } = open('#/find-company');
    await screen.findByRole('heading', { name: 'Find your company' });
    await user.type(screen.getByLabelText('Work email'), 'someone@company.test');
    await user.click(screen.getByRole('button', { name: 'Email me the link' }));
    expect(client.company.find).toHaveBeenCalledWith('someone@company.test');
    expect(await screen.findByText(/we have sent its sign-in link/)).toBeInTheDocument();
  });

  it('is reachable from the sign-in page when the company is not known', async () => {
    open('#/login');
    expect(await screen.findByRole('link', { name: /know your company code/ })).toHaveAttribute(
      'href',
      '#/find-company',
    );
  });
});

describe('sign in', () => {
  it('signs in and lands on the people list', async () => {
    const client = fakeClient();
    client.auth.login.mockResolvedValue({ status: 'ok', accessToken: 'a', expiresIn: 900 });
    const { user } = open('#/login', client);
    await screen.findByRole('heading', { name: 'Sign in' });
    await fillLogin(user);
    expect(client.auth.login).toHaveBeenCalledWith({
      tenant: 'flourisense',
      email: 'hr@flourisense.test',
      password: 'a long password',
    });
    expect(await screen.findByRole('heading', { name: 'Welcome, Hr' })).toBeInTheDocument();
    expect(location.hash).toBe('#/app/home');
  });

  it('shows the server’s message when the password is wrong', async () => {
    const client = fakeClient();
    client.auth.login.mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    const { user } = open('#/login', client);
    await screen.findByRole('heading', { name: 'Sign in' });
    await fillLogin(user, 'wrong password!!');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('asks for the authenticator code, then continues', async () => {
    const client = fakeClient();
    client.auth.login.mockResolvedValue({ status: 'mfa_required', mfaToken: 'm1' });
    client.auth.mfaVerify.mockResolvedValue({ status: 'ok', accessToken: 'a', expiresIn: 900 });
    const { user } = open('#/login', client);
    await screen.findByRole('heading', { name: 'Sign in' });
    await fillLogin(user);
    await screen.findByRole('heading', { name: 'Two-step check' });
    const verify = screen.getByRole('button', { name: 'Verify' });
    expect(verify).toBeDisabled();
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(verify);
    expect(client.auth.mfaVerify).toHaveBeenCalledWith({ mfaToken: 'm1', code: '123456' });
    expect(await screen.findByRole('heading', { name: 'Welcome, Hr' })).toBeInTheDocument();
  });

  it('lets someone use a recovery code instead', async () => {
    const client = fakeClient();
    client.auth.login.mockResolvedValue({ status: 'mfa_required', mfaToken: 'm1' });
    client.auth.mfaVerify.mockResolvedValue({ status: 'ok', accessToken: 'a', expiresIn: 900 });
    const { user } = open('#/login', client);
    await screen.findByRole('heading', { name: 'Sign in' });
    await fillLogin(user);
    await user.click(await screen.findByRole('button', { name: /recovery code/i }));
    await user.type(screen.getByLabelText('Recovery code'), 'abcde-12345');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(client.auth.mfaVerify).toHaveBeenCalledWith({
      mfaToken: 'm1',
      recoveryCode: 'abcde-12345',
    });
  });

  it('keeps signed-out visitors away from the app', async () => {
    open('#/app/people');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(location.hash).toBe('#/login');
  });

  it('restores a session from the refresh cookie on page load', async () => {
    const client = fakeClient({ restoreSession: vi.fn().mockResolvedValue(true) });
    open('#/login', client);
    expect(await screen.findByRole('heading', { name: 'Welcome, Hr' })).toBeInTheDocument();
  });
});

describe('people', () => {
  const signedIn = (over: Record<string, unknown> = {}) =>
    fakeClient({ restoreSession: vi.fn().mockResolvedValue(true), ...over });

  it('hides screens the role cannot use', async () => {
    const client = signedIn();
    client.auth.me.mockResolvedValue({ ...ME, permissions: ['self.read', 'people.read'] });
    open('#/app/people', client);
    await screen.findByText('Asha Patil');
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add person/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'People' })).toBeInTheDocument();
  });

  it('offers import when there are no people yet', async () => {
    const client = signedIn();
    client.people.list.mockResolvedValue({ total: 0, page: 1, pageSize: 25, items: [] });
    open('#/app/people', client);
    expect(await screen.findByText('No people yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import from CSV' })).toBeInTheDocument();
  });

  it('explains a failed load and can retry', async () => {
    const client = signedIn();
    client.people.list
      // the first load and both automatic retries fail; the manual retry succeeds
      .mockRejectedValueOnce(new ApiError(500, 'Server fell over'))
      .mockRejectedValueOnce(new ApiError(500, 'Server fell over'))
      .mockRejectedValueOnce(new ApiError(500, 'Server fell over'))
      .mockResolvedValue({ total: 1, page: 1, pageSize: 25, items: [ASHA] });
    const { user } = open('#/app/people', client);
    expect(await screen.findByText('Could not load people')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Asha Patil')).toBeInTheDocument();
  });

  it('opens a person and offers to invite them when they have no account', async () => {
    const client = signedIn();
    client.people.invite.mockResolvedValue({ email: 'asha@flourisense.test' });
    const { user } = open('#/app/people/e1', client);
    expect(await screen.findByRole('heading', { name: 'Asha Patil' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Invite to sign in' }));
    await waitFor(() => expect(client.people.invite).toHaveBeenCalledWith('e1'));
    expect(await screen.findByText('Invitation sent to asha@flourisense.test')).toBeInTheDocument();
  });
});

describe('import', () => {
  const csvFile = (text: string) => {
    const f = new File([text], 'people.csv', { type: 'text/csv' });
    f.text = async () => text;
    return f;
  };
  const result = (over = {}) => ({
    dryRun: true,
    totalRows: 2,
    valid: true,
    errors: [],
    committed: false,
    willCreate: { people: 2, departments: [], designations: [], locations: [] },
    willUpdate: { people: 0 },
    ...over,
  });

  it('shows problems with line numbers and blocks the import', async () => {
    const client = fakeClient({ restoreSession: vi.fn().mockResolvedValue(true) });
    client.people.import.mockResolvedValue(
      result({
        valid: false,
        errors: [{ line: 3, field: 'start_date', message: 'Use YYYY-MM-DD or DD/MM/YYYY' }],
      }),
    );
    const { user } = open('#/app/import', client);
    await user.upload(await screen.findByLabelText('CSV file'), csvFile('employee_code\nE1'));
    expect(await screen.findByText('Use YYYY-MM-DD or DD/MM/YYYY')).toBeInTheDocument();
    expect(screen.getByText('start_date')).toBeInTheDocument();
    // The sidebar also has an "Import" button; the action button is the last one on the page.
    expect(screen.getAllByRole('button', { name: 'Import' }).at(-1)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Import 2 people/ })).not.toBeInTheDocument();
    expect(client.people.import).toHaveBeenCalledWith('employee_code\nE1', {
      dryRun: true,
      createMissing: false,
    });
  });

  it('previews first, and only saves when confirmed', async () => {
    const client = fakeClient({ restoreSession: vi.fn().mockResolvedValue(true) });
    client.people.import
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result({ dryRun: false, committed: true }));
    const { user } = open('#/app/import', client);
    await user.upload(await screen.findByLabelText('CSV file'), csvFile('employee_code\nE1'));
    const go = await screen.findByRole('button', { name: 'Import 2 people' });
    expect(client.people.import).toHaveBeenCalledTimes(1); // preview only
    await user.click(go);
    expect(client.people.import).toHaveBeenLastCalledWith('employee_code\nE1', {
      dryRun: false,
      createMissing: false,
    });
    expect(await screen.findByText('2 added and 0 updated.')).toBeInTheDocument();
  });
});
