import { useState, useEffect } from 'react';
import axios from 'axios';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import './App.css';

const API_BASE_URL = 'https://tron-v2-3.onrender.com';

// --- UI COMPONENTS ---

// 1. Draggable Repository Card
function DraggableRepo({ repo }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: repo.full_name,
    data: { name: repo.full_name }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 1000,
  } : undefined;

  return (
    <div 
      ref={setNodeRef} 
      style={{
        ...style,
        background: '#ffffff',
        border: '1px solid var(--border-color)',
        padding: '12px 16px',
        borderRadius: 'var(--radius-md)',
        cursor: 'grab',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontWeight: '500'
      }} 
      {...listeners} 
      {...attributes}
    >
      <span style={{ color: 'var(--primary)' }}>📦</span> {repo.full_name}
    </div>
  );
}

// 2. Droppable Board Zone
function DroppableBoard({ board, mappedRepos, columns, repoConfigs, onConfigChange, onAutoMatchDiscord }) {
  const { isOver, setNodeRef } = useDroppable({
    id: board.id.toString(),
    data: { provider: board.provider }
  });

  const style = {
    backgroundColor: isOver ? '#f0f9ff' : '#fafafa',
    border: isOver ? '2px dashed var(--primary)' : '1px solid var(--border-color)',
    padding: '20px',
    borderRadius: 'var(--radius-md)',
    minHeight: '200px',
    transition: 'all 0.2s ease'
  };

  return (
    <div ref={setNodeRef} style={style}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--primary)' }}>📋</span> {board.name}
      </h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {mappedRepos.length === 0 ? <div className="empty-state">Drop repositories here...</div> : null}
        
        {mappedRepos.map(repoId => {
          const config = repoConfigs[repoId] || {};
          
          return (
            <div key={repoId} style={{ background: 'white', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--text-main)' }}>🔗 {repoId}</h4>
              
              {columns && columns.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.875rem' }}>
                  
                  {/* --- BASECAMP COLUMNS --- */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <strong style={{ width: '100px', color: 'var(--text-muted)' }}>To Do:</strong>
                    <select className="input-control" value={config.todo_column || ''} onChange={(e) => onConfigChange(repoId, 'todo_column', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <strong style={{ width: '100px', color: 'var(--text-muted)' }}>In Progress:</strong>
                    <select className="input-control" value={config.branch_created || ''} onChange={(e) => onConfigChange(repoId, 'branch_created', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <strong style={{ width: '100px', color: 'var(--text-muted)' }}>Under Review:</strong>
                    <select className="input-control" value={config.pull_request_opened || ''} onChange={(e) => onConfigChange(repoId, 'pull_request_opened', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <strong style={{ width: '100px', color: 'var(--text-muted)' }}>Done:</strong>
                    <select className="input-control" value={config.pull_request_closed || ''} onChange={(e) => onConfigChange(repoId, 'pull_request_closed', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  {/* --- BROADCAST SETUP --- */}
                  <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border-color)' }} />
                  <h5 style={{ margin: '0 0 12px 0', color: 'var(--text-main)', fontSize: '0.9rem' }}>📢 Broadcast Setup</h5>
                  
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <strong style={{ width: '100px', color: 'var(--text-muted)' }}>Platform:</strong>
                    <select className="input-control" value={config.comm_provider || 'none'} onChange={(e) => onConfigChange(repoId, 'comm_provider', e.target.value)}>
                      <option value="none">None</option>
                      <option value="discord">Discord</option>
                      <option value="slack">Slack</option>
                    </select>
                  </label>

                  {config.comm_provider === 'discord' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--bg-body)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)' }}>
                      
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <strong style={{ color: 'var(--text-muted)' }}>Discord Bot Token:</strong>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input 
                            type="password" 
                            placeholder="Paste Bot Token here..."
                            className="input-control"
                            value={config.comm_bot_token || ''}
                            onChange={(e) => onConfigChange(repoId, 'comm_bot_token', e.target.value)}
                          />
                          <button onClick={() => onAutoMatchDiscord(repoId)} type="button" disabled={config.match_status === 'loading'} className="btn btn-primary" style={{ backgroundColor: '#5865F2' }}>
                            {config.match_status === 'loading' ? '⏳...' : '✨ Auto-Match'}
                          </button>
                        </div>
                      </label>

                      {/* 🌟 THE STATUS BOX */}
                      <div style={{
                        padding: '10px',
                        background: config.match_status === 'error' ? '#fee2e2' : config.match_status === 'success' ? '#dcfce7' : '#ffffff',
                        color: config.match_status === 'error' ? '#991b1b' : config.match_status === 'success' ? '#166534' : 'var(--text-muted)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.8rem',
                        border: '1px solid',
                        borderColor: config.match_status === 'error' ? '#fca5a5' : config.match_status === 'success' ? '#86efac' : 'var(--border-color)',
                      }}>
                        {config.match_status === 'loading' && '⏳ Hunting for channel...'}
                        {config.match_status === 'error' && `❌ ${config.match_error}`}
                        {config.match_status === 'success' && `✅ Linked to: #${config.comm_channel_name} (${config.comm_channel_id})`}
                        {!config.match_status && 'ℹ️ Ready to auto-match...'}
                      </div>

                      <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '8px 0' }}>— OR —</div>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <strong style={{ color: 'var(--text-muted)' }}>Webhook URL (Fallback):</strong>
                        <input 
                          type="text" 
                          placeholder="Paste Webhook URL"
                          className="input-control"
                          value={config.comm_webhook || ''}
                          onChange={(e) => onConfigChange(repoId, 'comm_webhook', e.target.value)}
                        />
                      </label>

                    </div>
                  )}
                </div>
              ) : (
                <small style={{ color: 'var(--text-muted)' }}>Loading Basecamp columns...</small>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- MAIN APP ---

export default function App() {
  const [repos, setRepos] = useState([]);
  const [boards, setBoards] = useState([]);
  const [mappings, setMappings] = useState({}); 
  const [boardColumns, setBoardColumns] = useState({}); 
  const [repoConfigs, setRepoConfigs] = useState({}); 

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [credentials, setCredentials] = useState({
    GITHUB_TOKEN: '', BASECAMP_ACCOUNT_ID: '', BASECAMP_ACCESS_TOKEN: ''
  });
  const [basecampPeople, setBasecampPeople] = useState([]); 
  const [teamMap, setTeamMap] = useState([{ github: '', basecamp_id: '' }]);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over) return; 

    const repoId = active.id;
    const boardId = over.id;

    setMappings(prev => {
      const newMappings = { ...prev };
      Object.keys(newMappings).forEach(key => {
        newMappings[key] = newMappings[key].filter(id => id !== repoId);
      });
      newMappings[boardId].push(repoId);
      return newMappings;
    });

    if (!boardColumns[boardId] && credentials.BASECAMP_ACCESS_TOKEN) {
      try {
        const res = await axios.post('https://tron-v2-3.onrender.com/api/admin/columns', {
          accountId: credentials.BASECAMP_ACCOUNT_ID,
          accessToken: credentials.BASECAMP_ACCESS_TOKEN,
          projectId: boardId
        });
        
        setBoardColumns(prev => ({ ...prev, [boardId]: res.data.columns }));
      } catch (err) {
        console.error("Failed to fetch columns", err);
      }
    }
    
    setRepoConfigs(prev => ({
      ...prev,
      [repoId]: prev[repoId] || { 
        todo_column: '', branch_created: '', pull_request_opened: '', pull_request_closed: '',
        comm_provider: 'none', comm_bot_token: '', comm_channel_id: '', comm_webhook: ''
      }
    }));
  };

  const handleConfigChange = (repoId, field, value) => {
    setRepoConfigs(prev => ({
      ...prev,
      [repoId]: {
        ...prev[repoId],
        [field]: value
      }
    }));
  };

  const handleAutoMatchDiscord = async (repoId) => {
    const config = repoConfigs[repoId] || {};
    const token = config.comm_bot_token;

    if (!token) {
      handleConfigChange(repoId, 'match_error', "Please enter a Discord Bot Token first!");
      handleConfigChange(repoId, 'match_status', 'error');
      return;
    }
    
    handleConfigChange(repoId, 'match_status', 'loading');
    handleConfigChange(repoId, 'match_error', '');

    try {
      const res = await axios.post('https://tron-v2-3.onrender.com/api/admin/discord/match', {
        botToken: token,
        repoName: repoId
      });
      
      handleConfigChange(repoId, 'comm_channel_id', res.data.channelId);
      handleConfigChange(repoId, 'comm_channel_name', res.data.channelName);
      handleConfigChange(repoId, 'match_status', 'success');
      
    } catch (err) {
      handleConfigChange(repoId, 'match_error', err.response?.data?.error || "Failed to find channel.");
      handleConfigChange(repoId, 'match_status', 'error');
    }
  };

  const handleSave = async () => {
    const finalProjects = [];
    
    boards.forEach(board => {
      const mappedRepos = mappings[board.id] || [];
      mappedRepos.forEach(repoName => {
        const config = repoConfigs[repoName] || {};

        finalProjects.push({
          repo: repoName,
          pm_tool: { provider: board.provider, board_id: board.id.toString() },
          mapping: { 
            todo_column: config.todo_column || 'MISSING', 
            branch_created: config.branch_created || 'MISSING', 
            pull_request_opened: config.pull_request_opened || 'MISSING', 
            pull_request_closed: config.pull_request_closed || 'MISSING'
          },
          communication: { 
            provider: config.comm_provider || 'none',
            bot_token: config.comm_bot_token || '',
            channel_id: config.comm_channel_id || '',
            webhook_url: config.comm_webhook || '' 
          }
        });
      });
    });

    const finalTeam = teamMap.filter(m => m.github.trim() !== '' && m.basecamp_id !== '');

    try {
      await axios.post(`${API_BASE_URL}/api/admin/config`, { 
    projects: finalProjects, 
    team: finalTeam 
    });
      alert('🎉 Configuration and Team Roster saved successfully!');
    } catch (error) {
      alert('❌ Failed to save configuration.');
    }
  };

  const handleSaveCredentials = async (e) => {
    e.preventDefault();
    try {
      const repoRes = await axios.post('https://tron-v2-3.onrender.com/api/admin/github/repos', {
          githubToken: credentials.GITHUB_TOKEN
      });
      const fetchedRepos = repoRes.data.repos.map(r => ({ full_name: r.fullName }));
      setRepos(fetchedRepos);

        const boardRes = await axios.post('https://tron-v2-3.onrender.com/api/admin/boards', {
          provider: 'basecamp',
          accountId: credentials.BASECAMP_ACCOUNT_ID,
          accessToken: credentials.BASECAMP_ACCESS_TOKEN
      });

      const peopleRes = await axios.post('https://tron-v2-3.onrender.com/api/admin/basecamp/people', {
          accountId: credentials.BASECAMP_ACCOUNT_ID,
          accessToken: credentials.BASECAMP_ACCESS_TOKEN
      });
      setBasecampPeople(peopleRes.data.people);
      const fetchedBoards = boardRes.data.boards;
      setBoards(fetchedBoards);

      const initialMap = {};
      fetchedBoards.forEach(b => initialMap[b.id] = []);
      setMappings(initialMap);

      alert('✅ Systems Connected! Real Repositories and Boards loaded successfully.');
      setShowSettings(false); 
      
    } catch (error) {
      console.error(error);
      alert('❌ Failed to fetch data. Check your API tokens and ensure the Node server is running.');
    }
  };

  const unmappedRepos = repos.filter(repo => {
    return !Object.values(mappings).flat().includes(repo.full_name);
  });

  return (
    <div className="container">
      
      {/* HEADER */}
      <header className="config-header">
        <div className="config-title">
          <span style={{ color: '#f59e0b' }}>⚡</span> T.R.O.N. Enterprise Configurator
        </div>
        <div className="header-actions">
          <button onClick={() => setShowSettings(!showSettings)} className="btn btn-secondary">
            ⚙️ Integrations Setup
          </button>
          <button onClick={handleSave} className="btn btn-primary">Save Routing Rules</button>
        </div>
      </header>

      {/* CREDENTIALS SETTINGS PANEL */}
      {showSettings && (
        <div className="card">
          <h2 className="card-title">🔌 Connect Your Tools</h2>
          <p className="card-description">Enter your API tokens here. They will be saved securely to the backend.</p>
          <form onSubmit={handleSaveCredentials} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            
            <input type="password" placeholder="GitHub Personal Access Token" 
              onChange={e => setCredentials({...credentials, GITHUB_TOKEN: e.target.value})} 
              className="input-control" style={{ gridColumn: 'span 2' }} />

            <input type="text" placeholder="Basecamp Account ID" 
              onChange={e => setCredentials({...credentials, BASECAMP_ACCOUNT_ID: e.target.value})} 
              className="input-control" />
            
            <input type="password" placeholder="Basecamp Access Token" 
              onChange={e => setCredentials({...credentials, BASECAMP_ACCESS_TOKEN: e.target.value})} 
              className="input-control" />

            <button type="submit" className="btn btn-primary" style={{ gridColumn: 'span 2', justifyContent: 'center' }}>Connect Systems</button>
          </form>
        </div>
      )}

      {/* TEAM IDENTITY ROSTER */}
      <div className="card">
        <h2 className="card-title">👥 Team Identity Roster</h2>
        <p className="card-description">Map GitHub usernames to Basecamp profiles for auto-assignment and branch tracking.</p>
        
        {teamMap.map((member, index) => (
          <div className="mapping-row" key={index}>
            <input 
              type="text" 
              placeholder="GitHub Username (e.g. 0mkar22)" 
              value={member.github}
              onChange={(e) => {
                const newMap = [...teamMap];
                newMap[index].github = e.target.value;
                setTeamMap(newMap);
              }}
              className="input-control"
            />
            <span className="link-icon">🔗</span>
            <select 
              value={member.basecamp_id}
              onChange={(e) => {
                const newMap = [...teamMap];
                newMap[index].basecamp_id = e.target.value;
                setTeamMap(newMap);
              }}
              className="input-control"
            >
              <option value="">Select Basecamp User...</option>
              {basecampPeople.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
              ))}
            </select>
            <button 
              onClick={() => setTeamMap(teamMap.filter((_, i) => i !== index))}
              className="btn btn-danger"
              title="Remove Mapping"
            >✖</button>
          </div>
        ))}
        <button 
          onClick={() => setTeamMap([...teamMap, { github: '', basecamp_id: '' }])}
          className="btn btn-outline"
        >
          ➕ Add Team Member
        </button>
      </div>

      {/* DRAG AND DROP GRID */}
      <DndContext onDragEnd={handleDragEnd}>
        <div className="dashboard-grid">
          
          <div className="card">
            <h2 className="card-title">📁 Unmapped Repositories</h2>
            <p className="card-description">Repos detected by GitHub but not linked to a board.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {unmappedRepos.length === 0 ? <div className="empty-state">No unmapped repositories found.</div> : unmappedRepos.map(repo => (
                <DraggableRepo key={repo.full_name} repo={repo} />
              ))}
            </div>
          </div>

          <div className="card">
            <h2 className="card-title">📊 Project Management Boards</h2>
            <p className="card-description">Active routing rules for your linked boards.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {boards.length === 0 ? <div className="empty-state">Select a repository to view board mappings.</div> : boards.map(board => (
                <DroppableBoard 
                  key={board.id} 
                  board={board} 
                  mappedRepos={mappings[board.id] || []}
                  columns={boardColumns[board.id] || []} 
                  repoConfigs={repoConfigs} 
                  onConfigChange={handleConfigChange} 
                  onAutoMatchDiscord={handleAutoMatchDiscord} 
                />
              ))}
            </div>
          </div>

        </div>
      </DndContext>
    </div>
  );
}