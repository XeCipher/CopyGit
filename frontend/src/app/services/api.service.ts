import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RepoNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: RepoNode[];
  selected?: boolean;
  size?: number;
  expanded?: boolean;
}

export interface RepoInfo {
  default_branch: string;
  branches: string[];
  repo_name: string;
  full_name: string;
  owner: string;
  private: boolean;
  description: string;
  stars: number;
  language: string;
  size_kb: number;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  html_url: string;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getRepoInfo(url: string, token?: string): Observable<RepoInfo> {
    return this.http.post<RepoInfo>(`${this.baseUrl}/repo-info`, { url, token: token || '' });
  }

  getLatestCommit(url: string, branch: string, token?: string): Observable<CommitInfo> {
    return this.http.post<CommitInfo>(`${this.baseUrl}/latest-commit`, { url, branch, token: token || '' });
  }

  analyzeRepo(url: string, branch: string, token?: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/analyze`, { url, branch, token: token || '' });
  }

  // token is now forwarded so private repo tarballs can be downloaded in process.js
  processFiles(repoPath: string, files: string[], repoName: string, branch: string, owner: string, token?: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/process`, {
      repo_path: repoPath,
      files,
      repo_name: repoName,
      branch,
      owner,
      token: token || ''
    });
  }
}