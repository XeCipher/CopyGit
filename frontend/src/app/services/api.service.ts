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
  fileCount?: number;
  selectedCount?: number;
  selectedSize?: number;
}

export interface RepoInfo {
  default_branch: string;
  branches: string[];
  branches_truncated?: boolean;
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
  empty?: boolean;
  sha: string;
  tree_sha?: string;
  message: string;
  author: string;
  date: string;
  html_url: string;
  etag?: string;
  unchanged?: boolean;
}

export interface CommitsResponse {
  commits: CommitInfo[];
  has_more: boolean;
  page: number;
  empty?: boolean;
  not_found?: boolean;
}

export interface AnalyzeResponse {
  structure: RepoNode[];
  repo_path: string;
  repo_name: string;
  owner: string;
  branch: string;
  commit_sha: string;
  pinned_commit?: boolean;
  latest_commit: CommitInfo | null;
  truncated?: boolean;
  total_files?: number;
  empty?: boolean;
}

export interface ProcessResponse {
  full_text: string;
  file_count: number;
  selected_count?: number;
  skipped: string[];
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

  getLatestCommit(
    url: string,
    branch: string,
    token?: string,
    commitSha?: string,
    etag?: string
  ): Observable<CommitInfo> {
    return this.http.post<CommitInfo>(`${this.baseUrl}/latest-commit`, {
      url,
      branch,
      commit_sha: commitSha || '',
      etag: etag || '',
      token: token || ''
    });
  }

  getCommits(
    url: string,
    branch: string,
    page = 1,
    perPage = 30,
    token?: string,
    shaQuery?: string
  ): Observable<CommitsResponse> {
    return this.http.post<CommitsResponse>(`${this.baseUrl}/commits`, {
      url,
      branch,
      page,
      per_page: perPage,
      sha_query: shaQuery || '',
      token: token || ''
    });
  }

  analyzeRepo(
    url: string,
    branch: string,
    token?: string,
    commitSha?: string
  ): Observable<AnalyzeResponse> {
    return this.http.post<AnalyzeResponse>(`${this.baseUrl}/analyze`, {
      url,
      branch,
      commit_sha: commitSha || '',
      token: token || ''
    });
  }

  processFiles(
    repoPath: string,
    files: string[],
    repoName: string,
    branch: string,
    owner: string,
    token?: string,
    commitSha?: string
  ): Observable<ProcessResponse> {
    return this.http.post<ProcessResponse>(`${this.baseUrl}/process`, {
      repo_path: repoPath,
      files,
      repo_name: repoName,
      branch,
      commit_sha: commitSha || '',
      owner,
      token: token || ''
    });
  }
}