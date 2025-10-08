export interface CommandOptions {
  useWebSearch?: boolean;
  [key: string]: unknown;
}

export interface Command {
  name: string;
  execute: (prompt: string) => CommandResult;
}

export interface CommandResult {
  cleanedPrompt: string;
  options: CommandOptions;
}

export class CommandParser {
  private commands: Map<string, Command> = new Map();

  constructor() {
    this.registerDefaultCommands();
  }

  private registerDefaultCommands() {
    // Web search command
    this.commands.set('/web', {
      name: 'web',
      execute: (prompt: string) => ({
        cleanedPrompt: prompt.replace(/\s*\/web\s*/gi, '').trim(),
        options: { useWebSearch: true }
      })
    });

    // Add more commands here in the future
    // Example: this.commands.set('/image', { ... })
  }

  public registerCommand(trigger: string, command: Command) {
    this.commands.set(trigger, command);
  }

  public parse(prompt: string): CommandResult {
    let result: CommandResult = {
      cleanedPrompt: prompt,
      options: {}
    };

    // Check for commands in the prompt
    for (const [trigger, command] of this.commands.entries()) {
      if (prompt.includes(trigger)) {
        const commandResult = command.execute(prompt);
        result = {
          cleanedPrompt: commandResult.cleanedPrompt,
          options: { ...result.options, ...commandResult.options }
        };
      }
    }

    return result;
  }

  public getAvailableCommands(): string[] {
    return Array.from(this.commands.keys());
  }
}

export const commandParser = new CommandParser();
