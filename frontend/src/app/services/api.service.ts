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
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  analyzeRepo(url: string, branch: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/analyze`, { url, branch });
  }

  processFiles(repoPath: string, files: string[]): Observable<any> {
    return this.http.post(`${this.baseUrl}/process`, { repo_path: repoPath, files });
  }
}