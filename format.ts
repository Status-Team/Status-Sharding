import path from 'path';
import fs from 'fs';

// i need to get all ts files, and i need to scan them for all js doc comments, and i want to remove all except description, so it looks like this: /** Some text */

function getFiles(dir: string): string[] {
	const dirents = fs.readdirSync(dir, { withFileTypes: true });
	const files = dirents
		.filter((dirent) => dirent.isFile())
		.map((dirent) => path.join(dir, dirent.name));
	const directories = dirents.filter((dirent) => dirent.isDirectory()).map((dirent) => path.join(dir, dirent.name));
	for (const directory of directories) {
		files.push(...getFiles(directory));
	}
	return files;
}

function getJsDocComments(file: string): string[] {
	const content = fs.readFileSync(file, 'utf8');
	const comments = content.match(/\/\*\*[\s\S]*?\*\//g) || [];
	return comments;
}

function getJsDocDescription(comment: string): string {
	const lines = comment.split('\n');
	const description = lines.find((line) => line.trim().startsWith('* '))?.trim().slice(2).trim() || '';
	return description;
}

// and update them in the file

const files = getFiles(path.join(__dirname, 'src'));
for (const file of files) {
	const comments = getJsDocComments(file);
	const updatedComments = comments.map((comment) => `/** ${getJsDocDescription(comment)} */`);
	const content = fs.readFileSync(file, 'utf8');
	const updatedContent = updatedComments.reduce((acc, comment, i) => acc.replace(comments[i], comment), content);
	fs.writeFileSync(file, updatedContent, 'utf8');
}
