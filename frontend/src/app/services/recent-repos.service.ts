import { Injectable } from '@angular/core';

export interface RecentRepo {
  url: string;
  owner: string;
  repoName: string;
  fullName: string;
  branch: string;
  description: string;
  language: string;
  stars: number;
  private: boolean;
  totalFiles: number;
  lastAnalyzedAt: number;
}

const STORAGE_KEY = 'copygit_recent_repos';
const MAX_RECENT_REPOS = 6;

@Injectable({
  providedIn: 'root'
})
export class RecentReposService {

  getAll(): RecentRepo[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item): item is RecentRepo =>
          Boolean(
            item &&
            typeof item.url === 'string' &&
            typeof item.owner === 'string' &&
            typeof item.repoName === 'string'
          )
        )
        .map(item => ({
          url: item.url,
          owner: item.owner,
          repoName: item.repoName,
          fullName: item.fullName || `${item.owner}/${item.repoName}`,
          branch: typeof item.branch === 'string' ? item.branch : '',
          description: typeof item.description === 'string' ? item.description : '',
          language: typeof item.language === 'string' ? item.language : '',
          stars: Number(item.stars) || 0,
          private: Boolean(item.private),
          totalFiles: Number(item.totalFiles) || 0,
          lastAnalyzedAt: Number(item.lastAnalyzedAt) || 0,
        }))
        .sort((a, b) => b.lastAnalyzedAt - a.lastAnalyzedAt)
        .slice(0, MAX_RECENT_REPOS);
    } catch {
      return [];
    }
  }

  save(repo: Omit<RecentRepo, 'lastAnalyzedAt'>): RecentRepo[] {
    const normalizedKey = repo.fullName.toLowerCase();
    const entry: RecentRepo = {
      ...repo,
      lastAnalyzedAt: Date.now()
    };

    const existing = this.getAll().filter(
      item => item.fullName.toLowerCase() !== normalizedKey
    );

    const updated = [entry, ...existing].slice(0, MAX_RECENT_REPOS);
    this.persist(updated);
    return updated;
  }

  remove(fullName: string): RecentRepo[] {
    const target = fullName.toLowerCase();
    const updated = this.getAll().filter(
      item => item.fullName.toLowerCase() !== target
    );
    this.persist(updated);
    return updated;
  }

  clear(): RecentRepo[] {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors (e.g., restricted browsing modes)
    }
    return [];
  }

  private persist(repos: RecentRepo[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(repos));
    } catch {
      // Ignore quota or private-mode storage errors
    }
  }
}