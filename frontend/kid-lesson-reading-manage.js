const params = new URLSearchParams(window.location.search);
window.location.replace(`/kid-card-manage.html?${params.toString()}`);
