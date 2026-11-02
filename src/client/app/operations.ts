export type Operation = {
  account: string | undefined;
  workspace: string;
  isCurrent: () => boolean;
};

/** Epochs distinguish a new visit to the same account/workspace from an old one. */
export class Operations {
  private accountGeneration = 0;
  private workspaceGeneration = 0;
  private active = true;
  constructor(
    public account: string | undefined,
    public workspace: string,
  ) {}

  changeAccount(account: string | undefined) {
    if (this.account === account) {
      return;
    }
    this.account = account;
    this.accountGeneration++;
    this.workspaceGeneration++;
  }

  changeWorkspace(workspace: string) {
    if (this.workspace === workspace) {
      return;
    }
    this.workspace = workspace;
    this.workspaceGeneration++;
  }

  invalidate() {
    this.accountGeneration++;
    this.workspaceGeneration++;
  }

  invalidateWorkspace() {
    this.workspaceGeneration++;
  }

  activate() {
    this.active = true;
  }

  dispose() {
    this.active = false;
    this.invalidate();
  }

  capture(level: "account" | "workspace" = "workspace", allowed = () => true): Operation {
    const accountGeneration = this.accountGeneration;
    const workspaceGeneration = this.workspaceGeneration;

    return {
      account: this.account,
      workspace: this.workspace,
      isCurrent: () =>
        this.active &&
        this.accountGeneration === accountGeneration &&
        (level === "account" || this.workspaceGeneration === workspaceGeneration) &&
        allowed(),
    };
  }
}
