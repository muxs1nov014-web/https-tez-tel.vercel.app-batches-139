import { useState } from 'react';
import { ProfileSheet } from '../../components/layout/ProfileSheet';
import { ThemeToggle } from '../../components/layout/ThemeToggle';
import { NAV, TAB_ROOT_PATHS } from '../../components/layout/nav';
import { ListRow, ListSection } from '../../components/ui/List';
import { LockIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth, useCan } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/categories';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** "Ko'proq" tab (iPhone): every section that has no tab of its own, iOS Settings style. */
export function MorePage() {
  const { user, logout } = useAuth();
  const can = useCan();
  const [profileOpen, setProfileOpen] = useState(false);
  const name = user ? user.full_name || user.username : '';
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !TAB_ROOT_PATHS.has(item.to) && (!item.requires || can(item.requires))),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="mx-auto max-w-[680px]">
      <PageHeader title="Ko'proq" />
      <div className="space-y-8">
        {user && (
          <ListSection>
            <ListRow
              leading={
                <span
                  className="my-3 flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#a9a9ae] to-[#7c7c82] text-[21px] font-semibold text-white"
                  aria-hidden="true"
                >
                  {initials(name)}
                </span>
              }
              title={<span className="text-[20px] font-semibold tracking-[-0.03em]">{name}</span>}
              subtitle={`${ROLE_LABELS[user.role]} · @${user.username}`}
              onClick={() => setProfileOpen(true)}
              chevron
            />
            <ListRow title="Login va parol" icon={LockIcon} tint="gray" onClick={() => setProfileOpen(true)} chevron />
          </ListSection>
        )}
        <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />

        {groups.map((group) => (
          <ListSection key={group.label ?? 'main'} header={group.label}>
            {group.items.map((item) => (
              <ListRow key={item.to} to={item.to} icon={item.icon} tint={item.tint} title={item.label} />
            ))}
          </ListSection>
        ))}

        <ListSection header="Ko'rinish" footer="Avto rejimda ilova telefon mavzusiga moslashadi.">
          <li className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2">
            <span className="text-[17px] tracking-[-0.025em] text-slate-900">Mavzu</span>
            <ThemeToggle />
          </li>
        </ListSection>

        <ListSection>
          <ListRow title="Chiqish" tone="danger" center onClick={logout} />
        </ListSection>
      </div>
    </div>
  );
}
