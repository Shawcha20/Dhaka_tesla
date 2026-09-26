'use client';

import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  Reveal,
  Stat,
  TextInput,
} from '@/components/ui';
import {
  useChangePassword,
  useLogout,
  useSession,
  useUpdateProfile,
} from '@/hooks/use-session';
import { ApiError } from '@/lib/api';
import { formatTaka } from '@/lib/format';
import type { SessionUser } from '@/lib/types';

/**
 * Account settings, for both roles.
 *
 * One page rather than a passenger version and a driver version: name, phone and
 * password are the same three things whoever you are, and the only difference is the
 * card describing what you own — a wallet or a Tesla.
 */
export default function ProfilePage() {
  const { user } = useSession();

  return (
    <AppShell
      title="Your account"
      back={
        user?.role === 'DRIVER'
          ? { href: '/driver', label: 'Driving' }
          : { href: '/passenger', label: 'Your rides' }
      }
    >
      {user && (
        <div className="space-y-6">
          <Reveal>
            <IdentityCard user={user} />
          </Reveal>
          <Reveal delay={60}>
            <ProfileForm user={user} />
          </Reveal>
          <Reveal delay={120}>
            <PasswordForm />
          </Reveal>
          <Reveal delay={180}>
            <SignOutCard />
          </Reveal>
        </div>
      )}
    </AppShell>
  );
}

function IdentityCard({ user }: { user: SessionUser }) {
  return (
    <Card className="from-brand-50/60 bg-gradient-to-br to-white">
      <div className="flex items-start gap-4">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-neutral-900">{user.name}</h2>
          <p className="truncate text-sm text-neutral-600">{user.email}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge className="bg-brand-100 text-brand-700 ring-brand-200">
              {user.role === 'DRIVER' ? 'Driver' : 'Passenger'}
            </Badge>
            {user.phone ? (
              <Badge className="tabular">{user.phone}</Badge>
            ) : (
              <Badge className="bg-amber-50 text-amber-900 ring-amber-200">
                No phone on file
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* What the account owns. A driver's vehicle and a passenger's wallet are both
          read-only here: capacity is a property of the Tesla, and a balance moves
          only when a fare settles. Showing them as editable fields would imply
          otherwise. */}
      {user.vehicle && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-neutral-200 pt-4">
          <Stat label="Vehicle" value={user.vehicle.name} sub={user.vehicle.plateNo} />
          <Stat
            label="Seats"
            value={user.vehicle.capacity}
            sub={`${user.vehicle.capacity} passengers max`}
          />
          <Stat
            label="Status"
            value={user.vehicle.isOnline ? 'Online' : 'Offline'}
            sub={user.vehicle.isOnline ? 'Taking requests' : 'Not visible to riders'}
          />
        </div>
      )}

      {user.walletBalancePaisa !== null && (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-neutral-200 pt-4">
          <Stat
            label="TeslaPay balance"
            value={formatTaka(user.walletBalancePaisa)}
            sub="Debited when a ride completes"
          />
          <Stat label="Cash rides" value="Always available" sub="Paid to the driver" />
        </div>
      )}
    </Card>
  );
}

function ProfileForm({ user }: { user: SessionUser }) {
  const update = useUpdateProfile();

  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');

  const error = update.error instanceof ApiError ? update.error : null;

  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();
  const nameChanged = trimmedName !== user.name;
  const phoneChanged = trimmedPhone !== (user.phone ?? '');
  const dirty = nameChanged || phoneChanged;

  return (
    <Card>
      <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
        Your details
      </h2>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          /**
           * Only the changed fields are sent.
           *
           * Resending an unchanged phone number would be harmless but pointless, and
           * omitting a field is how the API is told to leave it alone — an empty
           * string is not the same instruction as `null`, which clears it.
           */
          update.mutate({
            ...(nameChanged ? { name: trimmedName } : {}),
            ...(phoneChanged ? { phone: trimmedPhone === '' ? null : trimmedPhone } : {}),
          });
        }}
      >
        {error && error.details.length === 0 && <Alert tone="error">{error.message}</Alert>}
        {update.isSuccess && !dirty && <Alert tone="success">Your details are saved.</Alert>}

        <Field label="Full name" htmlFor="profile-name" error={error?.fieldErrors['name']}>
          <TextInput
            id="profile-name"
            autoComplete="name"
            required
            minLength={2}
            value={name}
            invalid={Boolean(error?.fieldErrors['name'])}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          label="Phone"
          htmlFor="profile-phone"
          error={error?.fieldErrors['phone']}
          hint="Your driver sees this once you are matched. Clear it to remove it."
        >
          <TextInput
            id="profile-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            invalid={Boolean(error?.fieldErrors['phone'])}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+8801711000002"
          />
        </Field>

        <Field label="Email" htmlFor="profile-email" hint="Email cannot be changed here.">
          <TextInput id="profile-email" value={user.email} disabled />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setName(user.name);
                setPhone(user.phone ?? '');
                update.reset();
              }}
            >
              Discard
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const change = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const error = change.error instanceof ApiError ? change.error : null;

  return (
    <Card>
      <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
        Password
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Changing it signs you out of every device, including this one.
      </p>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          change.mutate({ currentPassword, newPassword });
        }}
      >
        {error && error.details.length === 0 && <Alert tone="error">{error.message}</Alert>}

        <Field
          label="Current password"
          htmlFor="current-password"
          error={error?.fieldErrors['currentPassword']}
        >
          <TextInput
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            invalid={Boolean(error?.fieldErrors['currentPassword'])}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>

        <Field
          label="New password"
          htmlFor="new-password"
          error={error?.fieldErrors['newPassword']}
          hint="At least 10 characters. Length matters more than symbols."
        >
          <TextInput
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={newPassword}
            invalid={Boolean(error?.fieldErrors['newPassword'])}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>

        <Button
          type="submit"
          loading={change.isPending}
          disabled={!currentPassword || !newPassword}
        >
          {change.isPending ? 'Updating…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}

function SignOutCard() {
  const logout = useLogout();

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-neutral-900">Sign out</p>
        <p className="text-sm text-neutral-500">Ends this session on this device only.</p>
      </div>
      <Button variant="secondary" loading={logout.isPending} onClick={() => logout.mutate()}>
        Sign out
      </Button>
    </Card>
  );
}
