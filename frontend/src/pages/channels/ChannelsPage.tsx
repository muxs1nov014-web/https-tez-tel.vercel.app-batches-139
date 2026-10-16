import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { channelKeys, createChannel, updateChannel, type Channel, type ChannelIn } from '../../api/channels';
import { errorMessage } from '../../api/client';
import { Can } from '../../components/Can';
import { Alert } from '../../components/ui/Alert';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, TableWrap } from '../../components/ui/Card';
import { PencilIcon, PlusIcon } from '../../components/ui/icons';
import { Field, Input, NumberInput } from '../../components/ui/Input';
import { ListRow, ListSection } from '../../components/ui/List';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingState, QueryView } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../lib/auth';
import { numToInput, parseInputNumber, toNum } from '../../lib/format';
import { useChannels } from '../../lib/queries';

export function ChannelsPage() {
  const query = useChannels();
  const [editing, setEditing] = useState<Channel | 'new' | null>(null);
  const canWrite = useCan()('channels.write');
  const empty = <EmptyState title="Kanal yo'q" description="Kamida bitta kanal (masalan, kargo) kerak." />;

  return (
    <div>
      <PageHeader
        title="Kanallar"
        subtitle="Olib kelish usuli. Bojxona koeffitsienti rastamojka taxminiga ko'paytiriladi (kargo 1.0, qo'lda 0.5)."
        actions={
          <Can do="channels.write">
            <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Kanal qo'shish
            </Button>
          </Can>
        }
      />
      {/* iPhone: inset-grouped list. */}
      <div className="md:hidden">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty} loading={<LoadingState />}>
          {(rows) => (
            <ListSection header="Bojxona koeffitsienti">
              {rows.map((c) => (
                <ListRow
                  key={c.id}
                  title={c.name}
                  subtitle={c.code}
                  value={`× ${toNum(c.customs_factor)}`}
                  valueStrong
                  onClick={canWrite ? () => setEditing(c) : undefined}
                  chevron={canWrite}
                />
              ))}
            </ListSection>
          )}
        </QueryView>
      </div>

      {/* iPad / Mac: the table. */}
      <Card className="hidden md:block">
        <QueryView query={query} isEmpty={(rows) => rows.length === 0} empty={empty}>
          {(rows) => (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Kod</th>
                    <th>Nomi</th>
                    <th className="num">Bojxona koeffitsienti</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono text-xs">{c.code}</td>
                      <td className="font-medium">{c.name}</td>
                      <td className="num">× {toNum(c.customs_factor)}</td>
                      {canWrite && (
                        <td className="w-8 text-right">
                          <IconButton label="Tahrirlash" onClick={() => setEditing(c)}>
                            <PencilIcon className="h-4 w-4" />
                          </IconButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </QueryView>
      </Card>
      {editing && <ChannelModal channel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChannelModal({ channel, onClose }: { channel: Channel | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState(channel?.code ?? '');
  const [name, setName] = useState(channel?.name ?? '');
  const [factor, setFactor] = useState(channel ? numToInput(channel.customs_factor) : '1');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: ChannelIn) =>
      channel
        ? updateChannel(channel.id, { name: body.name, customs_factor: body.customs_factor })
        : createChannel(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['tariffs', 'estimate'] });
      toast.success('Kanal saqlandi');
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const f = parseInputNumber(factor);
    if (!code.trim() || !name.trim()) {
      setError('Kod va nom majburiy');
      return;
    }
    if (f === undefined || f < 0) {
      setError("Koeffitsient 0 yoki undan katta son bo'lsin");
      return;
    }
    setError(null);
    mutation.mutate({ code: code.trim(), name: name.trim(), customs_factor: f });
  };

  return (
    <Modal open title={channel ? 'Kanalni tahrirlash' : "Kanal qo'shish"} onClose={onClose} size="sm">
      <form onSubmit={onSubmit} noValidate>
        <ModalBody className="space-y-3">
          <Field
            label="Kod"
            htmlFor="ch-code"
            required
            hint={channel ? "Kod yaratilgandan keyin o'zgarmaydi" : 'Lotin harflarida, masalan: cargo, hand'}
          >
            <Input
              id="ch-code"
              value={code}
              disabled={channel !== null}
              onChange={(e) => setCode(e.target.value)}
              autoFocus={channel === null}
            />
          </Field>
          <Field label="Nomi" htmlFor="ch-name" required>
            <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Bojxona koeffitsienti" htmlFor="ch-factor" required>
            <NumberInput id="ch-factor" value={factor} onChange={(e) => setFactor(e.target.value)} />
          </Field>
          {(error || mutation.isError) && <Alert tone="danger">{error ?? errorMessage(mutation.error)}</Alert>}
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Saqlash
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
