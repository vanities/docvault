import { useState } from 'react';
import { ListTodo, Plus, Trash2, Check } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function TodoList() {
  const { todos, addTodo, updateTodo, deleteTodo } = useAppContext();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const pendingTodos = todos.filter((t) => t.status === 'pending');
  const completedTodos = todos.filter((t) => t.status === 'completed');
  const [showCompleted, setShowCompleted] = useState(false);

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    await addTodo(newTitle.trim());
    setNewTitle('');
    setShowAddForm(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleAdd();
    if (e.key === 'Escape') {
      setNewTitle('');
      setShowAddForm(false);
    }
  };

  const handleToggle = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'pending' ? 'completed' : 'pending';
    await updateTodo(id, { status: newStatus });
  };

  const handleDelete = async (id: string) => {
    await deleteTodo(id);
  };

  if (pendingTodos.length === 0 && completedTodos.length === 0 && !showAddForm) {
    return (
      <div className="mb-4">
        <Button variant="ghost" size="xs" onClick={() => setShowAddForm(true)}>
          <ListTodo className="w-3.5 h-3.5" />
          Add todo
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-surface-600" />
          <h3 className="text-[12px] font-semibold text-surface-600 uppercase tracking-wider">
            Todos
          </h3>
          {pendingTodos.length > 0 && (
            <span className="text-[11px] bg-accent-500/15 text-accent-400 px-1.5 py-0.5 rounded-full font-medium">
              {pendingTodos.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="xs" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="w-3.5 h-3.5" />
          Add
        </Button>
      </div>

      {/* Pending todos */}
      <div className="space-y-1.5">
        {pendingTodos.map((todo) => (
          <div
            key={todo.id}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-200/30 border border-surface-400/20 transition-all group"
          >
            <button
              onClick={() => handleToggle(todo.id, todo.status)}
              className="w-4 h-4 rounded border border-surface-500 hover:border-accent-400 flex-shrink-0 flex items-center justify-center transition-colors"
              title="Mark complete"
            />
            <span className="flex-1 text-[13px] text-surface-900 min-w-0 truncate">
              {todo.title}
            </span>
            <Button
              variant="ghost-danger"
              size="icon-xs"
              onClick={() => handleDelete(todo.id)}
              className="opacity-0 group-hover:opacity-100"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="text"
            placeholder="What needs to be done?"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="flex-1 h-8 text-[13px]"
          />
          <Button size="xs" onClick={handleAdd} disabled={!newTitle.trim()}>
            Add
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setNewTitle('');
              setShowAddForm(false);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Completed todos (collapsible) */}
      {completedTodos.length > 0 && (
        <div className="mt-3">
          <Button variant="ghost" size="xs" onClick={() => setShowCompleted(!showCompleted)}>
            {showCompleted ? 'Hide' : 'Show'} completed ({completedTodos.length})
          </Button>
          {showCompleted && (
            <div className="space-y-1.5 mt-2">
              {completedTodos.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 transition-all group"
                >
                  <button
                    onClick={() => handleToggle(todo.id, todo.status)}
                    className="w-4 h-4 rounded border border-emerald-500/40 bg-emerald-500/20 flex-shrink-0 flex items-center justify-center transition-colors"
                    title="Mark pending"
                  >
                    <Check className="w-3 h-3 text-emerald-400" />
                  </button>
                  <span className="flex-1 text-[13px] text-surface-600 line-through min-w-0 truncate">
                    {todo.title}
                  </span>
                  <Button
                    variant="ghost-danger"
                    size="icon-xs"
                    onClick={() => handleDelete(todo.id)}
                    className="opacity-0 group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
