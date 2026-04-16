import { useState, useEffect } from 'react';
import axios from 'axios';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';

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
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="repo-card">
      📦 {repo.full_name}
    </div>
  );
}

// 2. Droppable Board Zone
// 🌟 NOTICE: onAutoMatchDiscord is safely passed in here!
function DroppableBoard({ board, mappedRepos, columns, repoConfigs, onConfigChange, onAutoMatchDiscord }) {
  const { isOver, setNodeRef } = useDroppable({
    id: board.id.toString(),
    data: { provider: board.provider }
  });

  const style = {
    backgroundColor: isOver ? '#e0f7fa' : '#f8f9fa',
    border: isOver ? '2px dashed #00acc1' : '2px solid #dee2e6',
    padding: '15px',
    borderRadius: '8px',
    minHeight: '200px'
  };

  return (
    <div ref={setNodeRef} style={style} className="board-zone">
      <h3>📋 {board.name}</h3>
      <div className="mapped-repos">
        {mappedRepos.length === 0 ? <p className="empty-text">Drop repos here...</p> : null}
        
        {mappedRepos.map(repoId => {
          const config = repoConfigs[repoId] || {};
          
          return (
            <div key={repoId} style={{ background: 'white', padding: '15px', borderRadius: '6px', marginTop: '10px', border: '1px solid #ccc' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>🔗 {repoId}</h4>
              
              {columns && columns.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
                  
                  {/* --- BASECAMP COLUMNS --- */}
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>To Do:</strong>
                    <select value={config.todo_column || ''} onChange={(e) => onConfigChange(repoId, 'todo_column', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>In Progress:</strong>
                    <select value={config.branch_created || ''} onChange={(e) => onConfigChange(repoId, 'branch_created', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>Under Review:</strong>
                    <select value={config.pull_request_opened || ''} onChange={(e) => onConfigChange(repoId, 'pull_request_opened', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>Done:</strong>
                    <select value={config.pull_request_closed || ''} onChange={(e) => onConfigChange(repoId, 'pull_request_closed', e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>

                  {/* --- BROADCAST SETUP --- */}
                  <hr style={{ margin: '15px 0', border: 'none', borderTop: '1px solid #eee' }} />
                  <h5 style={{ margin: '0 0 10px 0', color: '#555' }}>📢 Broadcast Setup</h5>
                  
                  <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>Platform:</strong>
                    <select value={config.comm_provider || 'none'} onChange={(e) => onConfigChange(repoId, 'comm_provider', e.target.value)}>
                      <option value="none">None</option>
                      <option value="discord">Discord</option>
                      <option value="slack">Slack</option>
                    </select>
                  </label>

                  {config.comm_provider === 'discord' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#f8f9fa', padding: '10px', borderRadius: '6px', border: '1px dashed #ccc' }}>
                      
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <strong>Discord Bot Token:</strong>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <input 
                            type="password" 
                            placeholder="Paste Bot Token here..."
                            value={config.comm_bot_token || ''}
                            onChange={(e) => onConfigChange(repoId, 'comm_bot_token', e.target.value)}
                            style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '12px' }}
                          />
                          <button onClick={() => onAutoMatchDiscord(repoId)} type="button" disabled={config.match_status === 'loading'} style={{ padding: '6px 10px', background: '#5865F2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                            {config.match_status === 'loading' ? '⏳...' : '✨ Auto-Match'}
                          </button>
                        </div>
                      </label>

                      {/* 🌟 THE ALWAYS-VISIBLE STATUS BOX 🌟 */}
                      <div style={{
                        marginTop: '2px', 
                        padding: '8px',
                        background: config.match_status === 'error' ? '#f8d7da' : config.match_status === 'success' ? '#e3ffeb' : '#f1f3f5',
                        color: config.match_status === 'error' ? '#842029' : config.match_status === 'success' ? '#0f5132' : '#868e96',
                        borderRadius: '4px',
                        fontSize: '12px',
                        border: '1px solid',
                        borderColor: config.match_status === 'error' ? '#f5c2c7' : config.match_status === 'success' ? '#badbcc' : '#dee2e6',
                        minHeight: '18px',
                      }}>
                        {config.match_status === 'loading' && '⏳ Hunting for channel...'}
                        {config.match_status === 'error' && `❌ ${config.match_error}`}
                        {config.match_status === 'success' && `✅ Linked to: #${config.comm_channel_name} (${config.comm_channel_id})`}
                        {!config.match_status && 'ℹ️ Ready to auto-match...'}
                      </div>

                      <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', margin: '4px 0' }}>— OR —</div>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <strong>Webhook URL (Fallback):</strong>
                        <input 
                          type="text" 
                          placeholder="Paste Webhook URL"
                          value={config.comm_webhook || ''}
                          onChange={(e) => onConfigChange(repoId, 'comm_webhook', e.target.value)}
                          style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '12px' }}
                        />
                      </label>

                    </div>
                  )}

                </div>
              ) : (
                <small style={{ color: '#666' }}>Loading Basecamp columns...</small>
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
  const [teamMap, setTeamMap] = useState([{ github: '', basecamp_id: '' }]); // Start with one empty row

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
        const res = await axios.post('http://localhost:3000/api/admin/columns', {
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
      const res = await axios.post('http://localhost:3000/api/admin/discord/match', {
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

    // 🌟 Extract valid team members
    const finalTeam = teamMap.filter(m => m.github.trim() !== '' && m.basecamp_id !== '');

    try {
      // 🌟 Send BOTH projects and the team to the backend
      await axios.post('http://localhost:3000/api/admin/config', { 
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
      const repoRes = await axios.post('http://localhost:3000/api/admin/github/repos', {
          githubToken: credentials.GITHUB_TOKEN
      });
      const fetchedRepos = repoRes.data.repos.map(r => ({ full_name: r.fullName }));
      setRepos(fetchedRepos);

      const boardRes = await axios.post('http://localhost:3000/api/admin/boards', {
          provider: 'basecamp',
          accountId: credentials.BASECAMP_ACCOUNT_ID,
          accessToken: credentials.BASECAMP_ACCESS_TOKEN
      });

      const peopleRes = await axios.post('http://localhost:3000/api/admin/basecamp/people', {
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
    <div className="dashboard-container">
      <header>
        <h1>⚡ T.R.O.N. Enterprise Configurator</h1>
        <div>
          <button onClick={() => setShowSettings(!showSettings)} className="save-btn" style={{ background: '#6c757d', marginRight: '10px' }}>
            ⚙️ Integrations Setup
          </button>
          <button onClick={handleSave} className="save-btn">Save Routing Rules</button>
        </div>
      </header>

      {showSettings && (
        <div className="settings-panel" style={{ background: 'white', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h2>🔌 Connect Your Tools</h2>
          <p>Enter your API tokens here. They will be saved securely to the backend.</p>
          <form onSubmit={handleSaveCredentials} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            
            <input type="password" placeholder="GitHub Personal Access Token" 
              onChange={e => setCredentials({...credentials, GITHUB_TOKEN: e.target.value})} 
              style={{ gridColumn: 'span 2', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />

            <input type="text" placeholder="Basecamp Account ID" 
              onChange={e => setCredentials({...credentials, BASECAMP_ACCOUNT_ID: e.target.value})} 
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
            
            <input type="password" placeholder="Basecamp Access Token" 
              onChange={e => setCredentials({...credentials, BASECAMP_ACCESS_TOKEN: e.target.value})} 
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />

            <button type="submit" className="save-btn" style={{ gridColumn: 'span 2' }}>Connect Systems</button>
          </form>
        </div>
      )}
      {/* 👥 THE IDENTITY MAPPING ROSTER */}
      <div className="team-roster" style={{ background: 'white', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h2>👥 Team Identity Roster</h2>
        <p style={{ color: '#555', marginBottom: '15px' }}>Map GitHub usernames to Basecamp profiles for auto-assignment and branch tracking.</p>
        
        {teamMap.map((member, index) => (
          <div key={index} style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="GitHub Username (e.g. 0mkar22)" 
              value={member.github}
              onChange={(e) => {
                const newMap = [...teamMap];
                newMap[index].github = e.target.value;
                setTeamMap(newMap);
              }}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', flex: 1 }}
            />
            <span style={{ fontSize: '20px' }}>🔗</span>
            <select 
              value={member.basecamp_id}
              onChange={(e) => {
                const newMap = [...teamMap];
                newMap[index].basecamp_id = e.target.value;
                setTeamMap(newMap);
              }}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', flex: 1 }}
            >
              <option value="">Select Basecamp User...</option>
              {basecampPeople.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
              ))}
            </select>
            <button 
              onClick={() => setTeamMap(teamMap.filter((_, i) => i !== index))}
              style={{ background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', padding: '8px 12px', cursor: 'pointer' }}
            >✖</button>
          </div>
        ))}
        <button 
          onClick={() => setTeamMap([...teamMap, { github: '', basecamp_id: '' }])}
          style={{ background: '#f8f9fa', color: '#333', border: '1px solid #ccc', borderRadius: '4px', padding: '8px 15px', cursor: 'pointer', marginTop: '10px' }}
        >
          ➕ Add Team Member
        </button>
      </div>

      <DndContext onDragEnd={handleDragEnd}>
        <div className="layout">
          <div className="repo-column">
            <h2>Unmapped Repositories</h2>
            <div className="repo-list">
              {unmappedRepos.map(repo => (
                <DraggableRepo key={repo.full_name} repo={repo} />
              ))}
            </div>
          </div>

          <div className="board-column">
            <h2>Project Management Boards</h2>
            <div className="board-grid">
              {boards.map(board => (
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