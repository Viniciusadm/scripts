const chalk = require('chalk').default;

const STATUS_LABELS = {
  free: { label: 'livre', color: chalk.green },
  busy: { label: 'ocupado', color: chalk.red.bold },
  freeing: { label: 'em desocupação', color: chalk.yellow },
};

function formatStatus(status) {
  const { label, color } = STATUS_LABELS[status] ?? STATUS_LABELS.free;
  return color(label);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'data desconhecida' : date.toLocaleDateString('pt-BR');
}

function formatStatusBadge(folder) {
  const since = folder.statusSince ? ` desde ${formatDate(folder.statusSince)}` : '';
  return `[${formatStatus(folder.status)}${since}]`;
}

module.exports = { formatStatus, formatDate, formatStatusBadge };
