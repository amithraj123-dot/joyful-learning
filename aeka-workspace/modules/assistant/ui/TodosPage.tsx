'use client';
// To-dos and reminders: side by side on a wide screen, as two tabs on a phone.
import { useState } from 'react';
import { Tabs, TabPanel } from '../../workflow/ui/components/Bits';
import { useMedia } from './lib';
import { TodoSection } from './Todos';
import { ReminderSection } from './Reminders';

type Tab = 'todos' | 'reminders';

export function TodosPage() {
  const phone = useMedia('(max-width: 900px)');
  const [tab, setTab] = useState<Tab>('todos');
  if (phone)
    return (
      <div className="as-todos-page">
        <Tabs<Tab>
          label="To-dos and reminders"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'todos', label: 'To-dos' },
            { id: 'reminders', label: 'Reminders' },
          ]}
        />
        <TabPanel id={tab}>{tab === 'todos' ? <TodoSection /> : <ReminderSection />}</TabPanel>
      </div>
    );
  return (
    <div className="as-todos-page as-columns">
      <section className="card as-card" aria-labelledby="as-todos-h">
        <div className="as-card-head">
          <h2 id="as-todos-h">To-dos</h2>
        </div>
        <TodoSection />
      </section>
      <section className="card as-card" aria-labelledby="as-reminders-h">
        <div className="as-card-head">
          <h2 id="as-reminders-h">Reminders</h2>
        </div>
        <ReminderSection />
      </section>
    </div>
  );
}
