import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, RepoNode } from './services/api.service';
import { TreeNodeComponent } from './components/tree-node/tree-node.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, TreeNodeComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  repoUrl: string = '';
  branchName: string = '';
  branches: string[] = [];
  loading: boolean = false;
  fetchingBranches: boolean = false;
  repoStructure: RepoNode[] | null = null;
  repoPath: string = '';
  finalText: string = '';
  tokenCount: number = 0;
  copyBtnText: string = 'Copy Content';

  constructor(private api: ApiService) {}

  onUrlChange() {
    if (this.repoUrl.includes('github.com/')) {
      const parts = this.repoUrl.split('/');
      // Ensure we have a valid-ish looking repo URL before calling
      if (parts.length >= 5) {
        this.fetchingBranches = true;
        this.api.getRepoInfo(this.repoUrl).subscribe({
          next: (res) => {
            this.branches = res.branches;
            this.branchName = res.default_branch;
            this.fetchingBranches = false;
          },
          error: () => {
            this.fetchingBranches = false;
          }
        });
      }
    }
  }

  onAnalyze() {
    if (!this.repoUrl || !this.branchName) return;
    this.loading = true;
    this.api.analyzeRepo(this.repoUrl, this.branchName).subscribe({
      next: (res) => {
        this.repoStructure = res.structure;
        this.repoPath = res.repo_path;
        this.selectAll(true);
        this.loading = false;
      },
      error: (err) => {
        alert("Error: " + err.error.error);
        this.loading = false;
      }
    });
  }

  selectAll(val: boolean) {
    if (this.repoStructure) {
      this.repoStructure.forEach(node => this.toggleRecursive(node, val));
    }
  }

  private toggleRecursive(node: RepoNode, val: boolean) {
    node.selected = val;
    if (node.children) node.children.forEach(c => this.toggleRecursive(c, val));
  }

  generateText() {
    if (!this.repoStructure) return;
    const files = this.collectPaths(this.repoStructure);
    this.loading = true;
    this.api.processFiles(this.repoPath, files).subscribe({
      next: (res) => {
        this.finalText = res.full_text;
        this.tokenCount = Math.ceil(this.finalText.length / 4);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  private collectPaths(nodes: RepoNode[], result: string[] = []) {
    for (const n of nodes) {
      if (n.type === 'file' && n.selected) result.push(n.path);
      else if (n.type === 'directory' && n.children) this.collectPaths(n.children, result);
    }
    return result;
  }

  copyToClipboard() {
    navigator.clipboard.writeText(this.finalText);
    this.copyBtnText = 'Copied!';
    setTimeout(() => this.copyBtnText = 'Copy Content', 2000);
  }

  downloadFile() {
    const blob = new Blob([this.finalText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CopyGit-${this.branchName}.txt`;
    a.click();
  }
}