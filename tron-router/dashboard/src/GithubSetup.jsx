import React, { useState } from 'react';
import axios from 'axios';

const GithubSetup = () => {
    const [token, setToken] = useState('');
    const [repos, setRepos] = useState([]);
    const [selectedRepos, setSelectedRepos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);

    const handleFetchRepos = async (e) => {
        e.preventDefault();
        setLoading(true);
        setStatusMessage(null);

        try {
            const response = await axios.post('http://localhost:3000/api/admin/github/repos', {
                githubToken: token
            });
            setRepos(response.data.repos);
        } catch (err) {
            setStatusMessage({ type: 'error', text: err.response?.data?.error || 'Failed to fetch repos.' });
        } finally {
            setLoading(false);
        }
    };

    const handleToggleRepo = (repoFullName) => {
        setSelectedRepos(prev => 
            prev.includes(repoFullName) 
                ? prev.filter(r => r !== repoFullName) 
                : [...prev, repoFullName]
        );
    };

    const handleSaveAndInstall = async () => {
        setLoading(true);
        setStatusMessage({ type: 'info', text: 'Installing webhooks... please wait.' });

        try {
            const response = await axios.post('http://localhost:3000/api/admin/save-config', {
                github_token: token,
                active_repos: selectedRepos
                // We will add pm_tool and communication here later!
            });
            
            setStatusMessage({ type: 'success', text: response.data.message });
        } catch (err) {
            setStatusMessage({ type: 'error', text: 'Failed to install webhooks.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '600px', margin: '40px auto', fontFamily: 'sans-serif' }}>
            <h2>Step 1: Connect GitHub</h2>
            
            <form onSubmit={handleFetchRepos} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <input 
                    type="password" 
                    placeholder="Paste GitHub Personal Access Token (PAT)"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
                    required
                />
                <button type="submit" disabled={loading} style={{ padding: '10px 20px', cursor: 'pointer', backgroundColor: '#0366d6', color: 'white', border: 'none', borderRadius: '4px' }}>
                    {loading ? 'Fetching...' : 'Connect'}
                </button>
            </form>

            {statusMessage && (
                <div style={{ 
                    padding: '10px', marginBottom: '20px', borderRadius: '4px',
                    backgroundColor: statusMessage.type === 'error' ? '#ffebee' : statusMessage.type === 'success' ? '#e8f5e9' : '#e3f2fd',
                    color: statusMessage.type === 'error' ? '#c62828' : statusMessage.type === 'success' ? '#2e7d32' : '#1565c0'
                }}>
                    {statusMessage.text}
                </div>
            )}

            {repos.length > 0 && (
                <div>
                    <h3>Select Repositories to Monitor:</h3>
                    <div style={{ border: '1px solid #eee', borderRadius: '8px', maxHeight: '300px', overflowY: 'auto', marginBottom: '20px' }}>
                        {repos.map(repo => (
                            <div key={repo.id} style={{ padding: '15px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '15px' }}>
                                <input 
                                    type="checkbox" 
                                    id={`repo-${repo.id}`} 
                                    checked={selectedRepos.includes(repo.fullName)}
                                    onChange={() => handleToggleRepo(repo.fullName)}
                                />
                                <label htmlFor={`repo-${repo.id}`} style={{ cursor: 'pointer', flex: 1 }}>
                                    <strong>{repo.fullName}</strong>
                                </label>
                            </div>
                        ))}
                    </div>
                    
                    <button 
                        onClick={handleSaveAndInstall}
                        disabled={loading || selectedRepos.length === 0}
                        style={{ width: '100%', padding: '15px', cursor: selectedRepos.length === 0 ? 'not-allowed' : 'pointer', backgroundColor: '#2ea44f', color: 'white', border: 'none', borderRadius: '4px', fontSize: '16px', fontWeight: 'bold' }}
                    >
                        {loading ? 'Processing...' : `Install T.R.O.N. on ${selectedRepos.length} Repositories`}
                    </button>
                </div>
            )}
        </div>
    );
};

export default GithubSetup;