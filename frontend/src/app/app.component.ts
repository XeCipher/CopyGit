import { Component, OnInit, Inject } from '@angular/core';
import { DOCUMENT, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, RepoNode, RepoInfo } from './services/api.service';
import { TreeNodeComponent } from './components/tree-node/tree-node.component';

type ErrorCode = 'private' | 'not_found' | 'lacks_permission' | 'invalid_token' | 'rate_limited' | 'forbidden' | 'unknown' | '';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, TreeNodeComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {

  // ── Theme ──
  isDark = false;

  // ── Token ──
  showTokenModal = false;
  githubToken = '';
  tokenSaved = false;
  showTokenValue = false;

  // ── URL / Branch ──
  repoUrl = '';
  branchName = '';
  branches: string[] = [];
  fetchingBranches = false;
  repoInfo: RepoInfo | null = null;
  repoError: ErrorCode = '';
  isPrivateDetected = false;
  private urlDebounce: any;

  // ── Tree / Analysis ──
  loading = false;
  repoStructure: RepoNode[] | null = null;
  repoPath = '';
  repoName = '';
  owner = '';
  branch = '';
  searchQuery = '';

  // ── Output ──
  generatingText = false;
  finalText = '';
  charCount = 0;
  tokenCount = 0;
  fileCount = 0;
  copyBtnText = 'Copy';
  copied = false;

  tokenSteps = [
    'Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub Token Settings</a> to create a new <strong>Fine-grained token</strong>.',
    'Set <em>Repository access</em> to <strong>All repositories</strong>. Then, under <em>Repository permissions</em>, set <strong>Contents</strong> to <strong>Read-only</strong>.',
    'Click <strong>Generate token</strong> at the bottom, then copy and paste it here.'
  ];

  constructor(
    private api: ApiService,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnInit() {
    // Theme: saved pref → system pref
    const saved = localStorage.getItem('copygit_theme');
    if (saved) {
      this.isDark = saved === 'dark';
    } else {
      this.isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    }
    this.applyTheme();

    // Token
    const tok = localStorage.getItem('copygit_github_token');
    if (tok) {
      this.githubToken = tok;
      this.tokenSaved = true;
    }

    // System theme listener
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem('copygit_theme')) {
        this.isDark = e.matches;
        this.applyTheme();
      }
    });
  }

  // ── THEME ──
  toggleTheme() {
    this.isDark = !this.isDark;
    localStorage.setItem('copygit_theme', this.isDark ? 'dark' : 'light');
    this.applyTheme();
  }

  private applyTheme() {
    this.document.documentElement.classList.toggle('dark', this.isDark);
  }

  // ── TOKEN ──
  saveToken() {
    const t = this.githubToken.trim();
    if (t) {
      localStorage.setItem('copygit_github_token', t);
      this.tokenSaved = true;
      this.githubToken = t;
      // Retry if we were blocked on private repo
      if (this.isPrivateDetected && this.repoUrl) {
        this.showTokenModal = false;
        this.fetchRepoInfo();
      } else {
        this.showTokenModal = false;
      }
    }
  }

  clearToken() {
    this.githubToken = '';
    this.tokenSaved = false;
    localStorage.removeItem('copygit_github_token');
  }

  // ── URL CHANGE ──
  onUrlChange() {
    clearTimeout(this.urlDebounce);
    this.repoError = '';
    this.isPrivateDetected = false;
    this.repoInfo = null;
    this.branches = [];
    this.branchName = '';

    const url = this.repoUrl.trim();
    if (!url.includes('github.com/')) return;

    const parts = url.split('/').filter(Boolean);
    // Need at least: github.com, owner, repo
    if (parts.length < 3) return;

    this.urlDebounce = setTimeout(() => this.fetchRepoInfo(), 550);
  }

  fetchRepoInfo() {
    this.fetchingBranches = true;
    this.repoError = '';
    this.api.getRepoInfo(this.repoUrl, this.githubToken || undefined).subscribe({
      next: res => {
        this.branches = res.branches;
        this.branchName = res.default_branch;
        this.repoInfo = res;
        this.fetchingBranches = false;
        this.repoError = '';
        this.isPrivateDetected = false;
      },
      error: err => {
        this.fetchingBranches = false;
        const code = err.error?.code || '';
        if (code === 'PRIVATE_OR_LACKS_PERMISSION') {
          if (this.githubToken) {
            this.repoError = 'lacks_permission';
          } else {
            this.repoError = 'private';
          }
          this.isPrivateDetected = true;
        } else if (code === 'INVALID_TOKEN') {
          this.repoError = 'invalid_token';
        } else if (code === 'FORBIDDEN') {
          this.repoError = 'forbidden';
        } else if (code === 'RATE_LIMITED') {
          this.repoError = 'rate_limited';
        } else {
          this.repoError = 'unknown';
        }
      }
    });
  }

  // ── ANALYZE ──
  onAnalyze() {
    if (!this.repoUrl || !this.branchName || this.loading) return;
    this.loading = true;
    this.finalText = '';
    this.repoStructure = null;

    this.api.analyzeRepo(this.repoUrl, this.branchName, this.githubToken || undefined).subscribe({
      next: res => {
        this.repoStructure = res.structure;
        this.repoPath = res.repo_path;
        this.repoName = res.repo_name;
        this.owner = res.owner;
        this.branch = res.branch || this.branchName;
        this.selectAll(true);
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        const code = err.error?.code || '';
        if (code === 'LACKS_CONTENTS_PERMISSION') {
          this.repoError = 'lacks_permission';
          this.showTokenModal = true;
        } else if (code === 'AUTH_FAILED') {
          this.repoError = 'private';
          this.showTokenModal = true;
        } else {
          alert(err.error?.error || 'Failed to clone repository. Please check the URL and try again.');
        }
      }
    });
  }

  // ── SELECT ALL / NONE ──
  selectAll(val: boolean) {
    if (!this.repoStructure) return;
    this.repoStructure.forEach(n => this.setRecursive(n, val));
  }

  private setRecursive(node: RepoNode, val: boolean) {
    node.selected = val;
    node.children?.forEach(c => this.setRecursive(c, val));
  }

  // ── GENERATE ──
  generateText() {
    if (!this.repoStructure) return;
    const files = this.collectFiles(this.repoStructure);
    if (!files.length) {
      alert('Select at least one file to generate a bundle.');
      return;
    }
    this.generatingText = true;
    this.api.processFiles(this.repoPath, files, this.repoName, this.branchName, this.owner).subscribe({
      next: res => {
        this.finalText = res.full_text;
        this.charCount = this.finalText.length;
        this.tokenCount = Math.ceil(this.finalText.length / 4);
        this.fileCount = res.file_count;
        this.generatingText = false;
      },
      error: err => {
        this.generatingText = false;
        const msg = err.error?.error || 'Failed to generate bundle.';
        if (err.error?.code === 'SESSION_EXPIRED') {
          alert('Session expired. Please re-analyze the repository.');
          this.repoStructure = null;
          this.finalText = '';
        } else {
          alert(msg);
        }
      }
    });
  }

  private collectFiles(nodes: RepoNode[], result: string[] = []): string[] {
    for (const n of nodes) {
      if (n.type === 'file' && n.selected) result.push(n.path);
      else if (n.type === 'directory' && n.children) this.collectFiles(n.children, result);
    }
    return result;
  }

  // ── COPY / DOWNLOAD ──
  copyToClipboard() {
    navigator.clipboard.writeText(this.finalText).then(() => {
      this.copied = true;
      this.copyBtnText = 'Copied!';
      setTimeout(() => {
        this.copied = false;
        this.copyBtnText = 'Copy';
      }, 2000);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = this.finalText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.copyBtnText = 'Copied!';
      setTimeout(() => this.copyBtnText = 'Copy', 2000);
    });
  }

  downloadFile() {
    const blob = new Blob([this.finalText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.repoName || 'copygit'}-${this.branchName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── COMPUTED ──
  get selectedFileCount(): number {
    if (!this.repoStructure) return 0;
    return this.collectFiles(this.repoStructure).length;
  }

  get filteredStructure(): RepoNode[] | null {
    if (!this.repoStructure) return null;
    if (!this.searchQuery.trim()) return this.repoStructure;
    return this.filterNodes(this.repoStructure, this.searchQuery.toLowerCase().trim());
  }

  private filterNodes(nodes: RepoNode[], q: string): RepoNode[] {
    const out: RepoNode[] = [];
    for (const n of nodes) {
      if (n.type === 'file') {
        if (n.name.toLowerCase().includes(q)) out.push(n);
      } else if (n.children) {
        const kids = this.filterNodes(n.children, q);
        if (kids.length || n.name.toLowerCase().includes(q)) {
          out.push({ ...n, children: kids, expanded: true } as any);
        }
      }
    }
    return out;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  openTokenHelp() {
    this.showTokenModal = true;
  }
}